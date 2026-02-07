#!/usr/bin/env node

/**
 * CLI entry point for giscus-bot.
 *
 * The CLI works in two modes:
 *   1. With a config file — loads personas, provider, etc. from YAML
 *   2. Without a config file — uses sensible defaults, everything via flags/env vars
 *
 * Usage without config file:
 *   giscus-bot generate https://myblog.com/post --dry-run
 *   giscus-bot generate https://myblog.com/post --provider claude --repo user/blog
 *
 * Usage with config file:
 *   giscus-bot generate https://myblog.com/post --config ./giscus-bot.config.yaml
 */

import { existsSync } from "node:fs";
import { Command } from "commander";
import { loadConfig } from "./config/loader.js";
import { createProvider } from "./providers/index.js";
import { generate } from "./core/generator.js";
import type { GiscusBotConfig, ProviderName } from "./config/types.js";

/**
 * Default config used when no config file is provided.
 * Lets users run `giscus-bot generate <url> --dry-run` with zero setup.
 */
function defaultConfig(): GiscusBotConfig {
  return {
    provider: {
      name: "openai",
      model: "gpt-4o",
    },
    github: {
      repo: "",
      discussionCategory: "General",
    },
    personas: [
      {
        name: "Curious Reader",
        description: "Asks thoughtful questions about the content",
        tone: "friendly, inquisitive",
      },
    ],
    limits: {
      maxPersonas: 1,
      postsPerRun: 1,
    },
    labeling: {
      prefix: "🤖 **AI-Generated Comment**",
    },
  };
}

const program = new Command();

program
  .name("giscus-bot")
  .description("AI-powered discussion starter for blog posts")
  .version("0.1.0");

program
  .command("generate")
  .description("Generate AI comments for a blog post")
  .argument("<url>", "Blog post URL to generate comments for")
  .option(
    "-c, --config <path>",
    "Path to config file (optional — defaults are used if not provided)",
  )
  .option(
    "-p, --provider <name>",
    "AI provider (openai|claude|ollama)",
  )
  .option(
    "-m, --model <name>",
    "AI model to use (e.g., gpt-4o, claude-sonnet-4-5-20250929)",
  )
  .option(
    "-r, --repo <owner/repo>",
    "GitHub repo for discussions (e.g., user/blog)",
  )
  .option(
    "--category <name>",
    "Discussion category to post in (default: General)",
  )
  .option(
    "-n, --max-personas <number>",
    "Max number of personas to use",
  )
  .option(
    "--dry-run",
    "Preview generated comments without posting to GitHub",
    false,
  )
  .action(async (url: string, opts: {
    config?: string;
    provider?: string;
    model?: string;
    category?: string;
    repo?: string;
    maxPersonas?: string;
    dryRun: boolean;
  }) => {
    try {
      // Load config from file if specified or if the default file exists.
      // Otherwise, use built-in defaults so the CLI works with zero config.
      let config: GiscusBotConfig;

      if (opts.config) {
        // Explicitly specified config file — error if it doesn't exist
        config = loadConfig(opts.config);
      } else if (existsSync("giscus-bot.config.yaml")) {
        // Default config file found in cwd — use it
        config = loadConfig("giscus-bot.config.yaml");
      } else {
        // No config file — use built-in defaults
        config = defaultConfig();
      }

      // CLI flags override config file values
      if (opts.provider) {
        config.provider.name = opts.provider as ProviderName;
      }
      if (opts.model) {
        config.provider.model = opts.model;
      }
      if (opts.repo) {
        config.github.repo = opts.repo;
      }
      if (opts.category) {
        config.github.discussionCategory = opts.category;
      }
      if (opts.maxPersonas) {
        config.limits.maxPersonas = parseInt(opts.maxPersonas, 10);
      }

      // Validate: repo is required unless dry-run
      if (!opts.dryRun && !config.github.repo) {
        console.error(
          "\nError: --repo is required when posting to GitHub. " +
          "Use --dry-run to preview without a repo, or set it in a config file.",
        );
        process.exit(1);
      }

      // Create the AI provider
      const provider = createProvider(config.provider);

      console.log(`\nGenerating comments for: ${url}`);
      console.log(`Provider: ${provider.name} (${config.provider.model})`);
      console.log(`Personas: ${config.personas.slice(0, config.limits.maxPersonas).map((p) => p.name).join(", ")}`);
      if (opts.dryRun) {
        console.log("Mode: DRY RUN (comments will not be posted)\n");
      }

      // Run the generation pipeline
      const result = await generate(url, config, provider, {
        dryRun: opts.dryRun,
      });

      // Display results
      console.log(`\nPost: "${result.postTitle}"`);
      if (result.discussionUrl) {
        console.log(`Discussion: ${result.discussionUrl}`);
      }

      // Print each generated comment with a separator
      console.log("\n" + "=".repeat(60));
      for (const comment of result.comments) {
        console.log(`\nPersona: ${comment.personaName}`);
        console.log("-".repeat(40));
        console.log(comment.formattedComment);
        console.log("\n" + "=".repeat(60));
      }

      console.log(
        `\nDone! Generated ${result.comments.length} comment(s).`,
      );
    } catch (error) {
      // Print a clean error message without a stack trace for known errors
      console.error(
        `\nError: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

// Parse command-line arguments and execute
program.parse();
