/**
 * GitHub Action entry point for giscus-bot.
 *
 * Runs as a composite action — inputs are passed as INPUT_* env vars.
 *
 * Trigger modes:
 *   1. Manual (workflow_dispatch): scrapes the provided blog-url
 *   2. Automatic (push, workflow_run, schedule): scans checkout for markdown
 *      files, picks random posts, and generates comments
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { loadConfig } from "./config/loader.js";
import { createProvider } from "./providers/index.js";
import { generate } from "./core/generator.js";
import { extractPostFromFile } from "./core/scraper.js";
import type { GiscusBotConfig, ProviderName } from "./config/types.js";

/** Map provider names to their env var for API keys */
const PROVIDER_ENV_MAP: Record<string, string> = {
  openai: "GISCUS_BOT_OPENAI_API_KEY",
  claude: "GISCUS_BOT_CLAUDE_API_KEY",
};

/** Directories to scan for blog posts (relative to repo root) */
const BLOG_DIRS = ["_posts", "content", "posts", "blog", "src/posts"];

/** Default config when no config file exists in the user's repo */
function defaultConfig(): GiscusBotConfig {
  return {
    provider: { name: "openai", model: "gpt-4o" },
    github: { repo: "", discussionCategory: "General" },
    personas: [
      {
        name: "Curious Reader",
        description: "Asks thoughtful questions about the content",
        tone: "friendly, inquisitive",
      },
    ],
    limits: { maxPersonas: 1, postsPerRun: 1 },
    labeling: { prefix: "🤖 **AI-Generated Comment**" },
  };
}

function info(msg: string): void {
  console.log(msg);
}

function fail(msg: string): void {
  console.error(`::error::${msg}`);
  process.exitCode = 1;
}

/**
 * Recursively find all markdown files (.md, .mdx) in a directory.
 */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if ([".md", ".mdx"].includes(extname(entry).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Scan all known blog directories for markdown files.
 */
function scanBlogPosts(): string[] {
  const files: string[] = [];
  for (const dir of BLOG_DIRS) {
    files.push(...findMarkdownFiles(dir));
  }
  return files;
}

/**
 * Fisher-Yates shuffle (in-place).
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function run(): Promise<void> {
  try {
    // Read inputs from INPUT_* env vars (set by composite action)
    const githubToken = process.env.INPUT_GITHUB_TOKEN;
    const providerName = process.env.INPUT_PROVIDER;
    const apiKey = process.env.INPUT_API_KEY;
    const model = process.env.INPUT_MODEL || "gpt-4o";
    const blogUrl = process.env.INPUT_BLOG_URL;
    const configPath = process.env.INPUT_CONFIG_PATH || "giscus-bot.config.yaml";

    if (!githubToken) throw new Error("github-token input is required");
    if (!providerName) throw new Error("provider input is required");
    if (!apiKey) throw new Error("api-key input is required");

    // Set env vars for provider constructors and publisher
    process.env.GISCUS_BOT_GITHUB_TOKEN = githubToken;
    if (PROVIDER_ENV_MAP[providerName]) {
      process.env[PROVIDER_ENV_MAP[providerName]] = apiKey;
    }

    // Load config or use defaults
    let config: GiscusBotConfig;
    if (existsSync(configPath)) {
      config = loadConfig(configPath);
    } else {
      config = defaultConfig();
    }

    // Override from action inputs
    config.provider.name = providerName as ProviderName;
    config.provider.model = model;

    // Ensure postsPerRun has a default
    config.limits.postsPerRun = config.limits.postsPerRun ?? 1;

    // Infer repo from GITHUB_REPOSITORY if not in config
    if (!config.github.repo && process.env.GITHUB_REPOSITORY) {
      config.github.repo = process.env.GITHUB_REPOSITORY;
    }

    const provider = createProvider(config.provider);

    if (blogUrl) {
      // ── Manual trigger (workflow_dispatch) ──
      info(`Processing URL: ${blogUrl}`);
      const result = await generate(blogUrl, config, provider);
      info(`Generated ${result.comments.length} comment(s) for "${result.postTitle}"`);
      if (result.discussionUrl) info(`Discussion: ${result.discussionUrl}`);
    } else {
      // ── Automatic trigger (push, workflow_run, schedule) ──
      const allFiles = scanBlogPosts();
      if (allFiles.length === 0) {
        info("No blog posts found in any standard directory. Nothing to do.");
        return;
      }

      info(`Found ${allFiles.length} blog post(s) across all directories.`);

      // Shuffle and pick postsPerRun random posts
      shuffle(allFiles);
      const selected = allFiles.slice(0, config.limits.postsPerRun);
      info(`Selected ${selected.length} random post(s) to comment on.`);

      for (const file of selected) {
        info(`Processing file: ${file}`);
        const postContext = extractPostFromFile(file);
        info(`Extracted post: "${postContext.title}"`);
        const result = await generate(postContext, config, provider);
        info(`Generated ${result.comments.length} comment(s) for "${result.postTitle}"`);
        if (result.discussionUrl) info(`Discussion: ${result.discussionUrl}`);
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

run();
