/**
 * GitHub Discussions publisher.
 *
 * Manages the lifecycle of GitHub Discussions and comments using the GraphQL API.
 * This module handles:
 *   - Looking up repository and discussion category IDs
 *   - Finding existing discussions (to avoid duplicates)
 *   - Creating new discussions for blog posts
 *   - Adding AI-generated top-level comments
 *
 * We use GraphQL (not REST) because the GitHub Discussions API is
 * only available through GraphQL.
 */

import { graphql } from "@octokit/graphql";

/** Authenticated GraphQL client type */
type GraphQLClient = typeof graphql;

/**
 * Result of looking up a repository's ID and discussion categories.
 * Needed as input for creating discussions.
 */
interface RepoInfo {
  repoId: string;
  categoryId: string;
}

/**
 * Create an authenticated GraphQL client for the GitHub API.
 *
 * @param token - GitHub PAT with discussions:write scope.
 *                Falls back to GISCUS_BOT_GITHUB_TOKEN env var.
 */
function createClient(token?: string): GraphQLClient {
  const authToken = token ?? process.env.GISCUS_BOT_GITHUB_TOKEN;
  if (!authToken) {
    throw new Error(
      "GitHub token is required. Set GISCUS_BOT_GITHUB_TOKEN or pass it explicitly.",
    );
  }
  return graphql.defaults({
    headers: { authorization: `token ${authToken}` },
  });
}

/**
 * Fetch the repository node ID and the ID of a specific discussion category.
 *
 * GitHub's GraphQL API uses opaque node IDs (not numeric IDs) for mutations,
 * so we need to look these up before we can create discussions.
 */
export async function getRepoInfo(
  owner: string,
  repo: string,
  categoryName: string,
  token?: string,
): Promise<RepoInfo> {
  const client = createClient(token);

  // Query the repo ID and all discussion categories in one request
  const result = await client<{
    repository: {
      id: string;
      discussionCategories: {
        nodes: Array<{ id: string; name: string }>;
      };
    };
  }>(
    `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
        discussionCategories(first: 25) {
          nodes {
            id
            name
          }
        }
      }
    }`,
    { owner, repo },
  );

  // Find the matching category by name (case-insensitive for robustness)
  const category = result.repository.discussionCategories.nodes.find(
    (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
  );

  if (!category) {
    const available = result.repository.discussionCategories.nodes
      .map((c) => c.name)
      .join(", ");
    throw new Error(
      `Discussion category "${categoryName}" not found. Available: ${available}`,
    );
  }

  return {
    repoId: result.repository.id,
    categoryId: category.id,
  };
}

/**
 * Search for an existing discussion by title within a repository.
 *
 * Uses GitHub's search API to find discussions matching the blog post title.
 * This prevents creating duplicate discussions for the same post.
 *
 * @returns The discussion node ID if found, null otherwise.
 */
export async function findDiscussion(
  owner: string,
  repo: string,
  title: string,
  token?: string,
): Promise<{ id: string; url: string } | null> {
  const client = createClient(token);

  // GitHub search syntax: filter by repo and type:discussion
  const searchQuery = `repo:${owner}/${repo} "${title}" in:title type:discussion`;

  const result = await client<{
    search: {
      nodes: Array<{ id: string; title: string; url: string }>;
    };
  }>(
    `query($searchQuery: String!) {
      search(query: $searchQuery, type: DISCUSSION, first: 5) {
        nodes {
          ... on Discussion {
            id
            title
            url
          }
        }
      }
    }`,
    { searchQuery },
  );

  // Find an exact title match among the search results
  // (search is fuzzy, so we need to verify the title matches)
  const match = result.search.nodes.find((d) => d.title === title);
  return match ? { id: match.id, url: match.url } : null;
}

/**
 * Create a new GitHub Discussion.
 *
 * @returns The new discussion's node ID and URL.
 */
export async function createDiscussion(
  repoId: string,
  categoryId: string,
  title: string,
  body: string,
  token?: string,
): Promise<{ id: string; url: string }> {
  const client = createClient(token);

  const result = await client<{
    createDiscussion: {
      discussion: { id: string; url: string };
    };
  }>(
    `mutation($input: CreateDiscussionInput!) {
      createDiscussion(input: $input) {
        discussion {
          id
          url
        }
      }
    }`,
    {
      input: { repositoryId: repoId, categoryId, title, body },
    },
  );

  return result.createDiscussion.discussion;
}

/**
 * Add a top-level comment to an existing discussion.
 *
 * Note: giscus-bot only posts top-level comments, never replies.
 * Replies are reserved for human readers.
 */
export async function addComment(
  discussionId: string,
  body: string,
  token?: string,
): Promise<{ id: string }> {
  const client = createClient(token);

  const result = await client<{
    addDiscussionComment: {
      comment: { id: string };
    };
  }>(
    `mutation($input: AddDiscussionCommentInput!) {
      addDiscussionComment(input: $input) {
        comment {
          id
        }
      }
    }`,
    {
      input: { discussionId, body },
    },
  );

  return result.addDiscussionComment.comment;
}

/**
 * Get the set of persona names that have already commented on a discussion.
 *
 * Queries the discussion's comments via GraphQL and checks if any start
 * with the labeling prefix pattern. Extracts persona names from comments
 * matching the format: `<prefix> · Persona: <name>`.
 *
 * @param discussionId - The discussion node ID.
 * @param labelPrefix - The labeling prefix used by the bot (e.g., "🤖 **AI-Generated Comment**").
 * @param token - GitHub PAT.
 * @returns Set of persona names that have already commented.
 */
export async function getDiscussionBotComments(
  discussionId: string,
  labelPrefix: string,
  token?: string,
): Promise<Set<string>> {
  const client = createClient(token);

  const result = await client<{
    node: {
      comments: {
        nodes: Array<{ body: string }>;
      };
    };
  }>(
    `query($id: ID!) {
      node(id: $id) {
        ... on Discussion {
          comments(first: 100) {
            nodes {
              body
            }
          }
        }
      }
    }`,
    { id: discussionId },
  );

  const personas = new Set<string>();
  const prefix = `${labelPrefix} · Persona: `;

  for (const comment of result.node.comments.nodes) {
    if (comment.body.startsWith(prefix)) {
      // Extract persona name from the first line
      const firstLine = comment.body.split("\n")[0];
      const name = firstLine.slice(prefix.length).trim();
      if (name) {
        personas.add(name);
      }
    }
  }

  return personas;
}

/**
 * Find an existing discussion or create a new one for a blog post.
 *
 * This is the main entry point for the publisher — it ensures exactly
 * one discussion exists per blog post title, creating it only if needed.
 *
 * @param owner - GitHub repository owner
 * @param repo - GitHub repository name
 * @param categoryName - Discussion category name (e.g., "Blog Comments")
 * @param title - Blog post title (becomes the discussion title)
 * @param body - Discussion body text (typically a link to the blog post)
 * @returns The discussion's node ID and URL
 */
export async function findOrCreateDiscussion(
  owner: string,
  repo: string,
  categoryName: string,
  title: string,
  body: string,
  token?: string,
): Promise<{ id: string; url: string }> {
  // First, check if a discussion already exists for this post
  const existing = await findDiscussion(owner, repo, title, token);
  if (existing) {
    return existing;
  }

  // No existing discussion — create a new one
  const repoInfo = await getRepoInfo(owner, repo, categoryName, token);
  return createDiscussion(repoInfo.repoId, repoInfo.categoryId, title, body, token);
}
