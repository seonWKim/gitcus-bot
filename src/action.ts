/**
 * GitHub Action entry point for giscus-bot.
 *
 * Supports two trigger modes:
 *
 *   1. Manual trigger (workflow_dispatch): User provides a blog-url input.
 *      The URL is scraped and comments are generated from the live page.
 *
 *   2. Push trigger: Detects new/modified markdown files from the commit,
 *      reads them directly from the checkout, and generates comments from
 *      the file content. No URL mapping or framework config needed.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig } from "./config/loader.js";
import { createProvider } from "./providers/index.js";
import { generate } from "./core/generator.js";
import { extractPostFromFile } from "./core/scraper.js";
import type { ProviderName } from "./config/types.js";

/**
 * Map provider names to their corresponding environment variable names.
 * The action's api-key input gets set to the correct env var so that
 * provider constructors can find it automatically.
 */
const PROVIDER_ENV_MAP: Record<string, string> = {
  openai: "GISCUS_BOT_OPENAI_API_KEY",
  claude: "GISCUS_BOT_CLAUDE_API_KEY",
};

async function run(): Promise<void> {
  try {
    // Read GitHub Action inputs
    const githubToken = core.getInput("github-token", { required: true });
    const providerName = core.getInput("provider", { required: true });
    const apiKey = core.getInput("api-key", { required: true });
    const model = core.getInput("model") || "gpt-4o";
    const blogUrl = core.getInput("blog-url");
    const configPath = core.getInput("config-path") || "giscus-bot.config.yaml";

    // Set env vars so that provider constructors and publisher can find them
    process.env.GISCUS_BOT_GITHUB_TOKEN = githubToken;
    if (PROVIDER_ENV_MAP[providerName]) {
      process.env[PROVIDER_ENV_MAP[providerName]] = apiKey;
    }

    // Load config from the repo's config file
    const config = loadConfig(configPath);

    // Override provider settings from action inputs
    config.provider.name = providerName as ProviderName;
    config.provider.model = model;

    const provider = createProvider(config.provider);

    if (blogUrl) {
      // ── Manual trigger (workflow_dispatch) ──
      // Scrape the live URL and generate comments
      core.info(`Processing URL: ${blogUrl}`);

      const result = await generate(blogUrl, config, provider);

      core.info(`Generated ${result.comments.length} comment(s) for "${result.postTitle}"`);
      if (result.discussionUrl) {
        core.info(`Discussion: ${result.discussionUrl}`);
      }

      core.setOutput("comments-generated", "1");
    } else {
      // ── Push trigger ──
      // Detect newly added markdown files from the push commits.
      // We intentionally skip modified files to avoid duplicate comments
      // on posts that are just being edited.
      const payload = github.context.payload;
      const files: string[] = [];

      if (payload.commits) {
        for (const commit of payload.commits) {
          const commitFiles = (commit.added ?? []) as string[];

          for (const file of commitFiles) {
            // Only process markdown files in common blog content directories
            if (
              file.match(/\.(md|mdx)$/) &&
              file.match(/^(content|_posts|src\/posts|posts|blog)\//)
            ) {
              files.push(file);
            }
          }
        }
      }

      if (files.length === 0) {
        core.info("No new blog posts detected in this push. Nothing to do.");
        return;
      }

      // Read each file directly from the checkout and generate comments
      for (const file of files) {
        core.info(`Processing file: ${file}`);

        // Extract post content from the local markdown file
        // (reads front matter for title, body for content)
        const postContext = extractPostFromFile(file);
        core.info(`Extracted post: "${postContext.title}"`);

        const result = await generate(postContext, config, provider);

        core.info(`Generated ${result.comments.length} comment(s) for "${result.postTitle}"`);
        if (result.discussionUrl) {
          core.info(`Discussion: ${result.discussionUrl}`);
        }
      }

      core.setOutput("comments-generated", files.length.toString());
    }
  } catch (error) {
    // Mark the action as failed with a clear error message
    core.setFailed(
      error instanceof Error ? error.message : String(error),
    );
  }
}

// Execute the action
run();
