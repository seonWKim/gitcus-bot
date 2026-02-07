# giscus-bot

You write a blog post. No one comments. You write another. Silence. Without feedback, you don't know what resonates, what confuses, or whether anyone even read it. You stop writing.

**giscus-bot breaks this cycle.** It generates AI-powered discussion-starter comments on your blog posts and posts them to GitHub Discussions. A seeded conversation gives readers something to respond to — lowering the barrier from "write the first comment" to "join an existing discussion."

All AI comments are clearly labeled. Only top-level — replies are reserved for humans.

**Supported providers:** OpenAI | Claude (TBD) | Ollama (TBD)

## How to Use

### CLI

```bash
npm install -g giscus-bot
```

```bash
# Preview without posting
GISCUS_BOT_OPENAI_API_KEY=sk-xxx \
  giscus-bot generate https://myblog.com/post --dry-run

# Generate and post to GitHub Discussions
GISCUS_BOT_OPENAI_API_KEY=sk-xxx \
GISCUS_BOT_GITHUB_TOKEN=ghp_xxx \
  giscus-bot generate https://myblog.com/post --repo user/blog
```

No config file needed. Defaults to OpenAI `gpt-4o` with a "Curious Reader" persona.

### GitHub Action

**Before setup, configure your blog repo:**
1. **Settings > General > Features > enable Discussions**
2. **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**
   - Set **Repository access** to your blog repo
   - Under **Permissions > Repository permissions**, set **Discussions** to **Read and write**
3. **Settings > Secrets and variables > Actions** — add two repository secrets:
   - **`GISCUS_BOT_GITHUB_TOKEN`** — the PAT you just created
   - **`GISCUS_BOT_OPENAI_API_KEY`** — your OpenAI API key

Create `.github/workflows/giscus-bot.yml`:

```yaml
name: Generate Discussion Comments

on:
  push:
    paths: ["_posts/**"]       # auto-trigger on new posts

  workflow_dispatch:            # manual trigger
    inputs:
      url:
        description: "Blog post URL"
        required: true
        type: string

jobs:
  comment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: seonWKim/giscus-bot@main
        with:
          github-token: ${{ secrets.GISCUS_BOT_GITHUB_TOKEN }}
          api-key: ${{ secrets.GISCUS_BOT_OPENAI_API_KEY }}
          blog-url: ${{ github.event.inputs.url }}
```

- **Push trigger**: detects newly added markdown files in the commit and reads them directly from the checkout
- **Manual trigger**: scrapes the live blog URL you provide
- `actions/checkout@v4` is required so the action can read your posts and config
- No build step needed in your workflow — the action handles `npm ci` and `tsc` internally

### Config File (optional)

Place `giscus-bot.config.yaml` in your **project root** (the repository root for GitHub Action, or the directory where you run the CLI). The CLI also accepts `--config <path>` to point to a different location.

```
your-blog/
├── _posts/
├── giscus-bot.config.yaml   ← here
└── .github/workflows/giscus-bot.yml
```

Example:

```yaml
provider:
  name: openai
  model: gpt-4o

github:
  repo: "user/blog"
  discussionCategory: "General"

personas:
  - name: "Curious Reader"
    description: "Asks thoughtful questions about the content"
    tone: "friendly, inquisitive"
  - name: "Devil's Advocate"
    description: "Offers respectful counterpoints"
    tone: "constructive, analytical"

limits:
  maxPersonas: 2

labeling:
  prefix: "🤖 **AI-Generated Comment**"
```

## Details

### CLI Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview comments without posting |
| `-p, --provider <name>` | AI provider (`openai`) |
| `-m, --model <name>` | AI model (default: `gpt-4o`) |
| `-r, --repo <owner/repo>` | GitHub repo for discussions |
| `--category <name>` | Discussion category (default: `General`) |
| `-n, --max-personas <n>` | Max personas to use |
| `-c, --config <path>` | Path to config file |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GISCUS_BOT_GITHUB_TOKEN` | GitHub PAT with `discussions:write` |
| `GISCUS_BOT_OPENAI_API_KEY` | OpenAI API key |
| `GISCUS_BOT_CLAUDE_API_KEY` | Anthropic API key (TBD) |
| `GISCUS_BOT_OLLAMA_URL` | Ollama base URL (TBD) |

### Action Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | Yes | | GitHub PAT with `discussions:write` (see setup above) |
| `provider` | No | `openai` | AI provider |
| `api-key` | Yes | | API key for the provider |
| `model` | No | `gpt-4o` | AI model |
| `blog-url` | No | | Blog post URL (manual trigger) |
| `config-path` | No | `giscus-bot.config.yaml` | Config file path |

### How It Works

1. **Extract** — scrape a URL or read a markdown file (front matter + body)
2. **Generate** — send the content to the AI with each persona's instructions
3. **Publish** — create/find a GitHub Discussion and post labeled comments

## License

MIT
