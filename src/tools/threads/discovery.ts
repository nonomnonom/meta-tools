import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatDate, ResponseFormatSchema } from "../../services/utils.js";
import { THREADS_MEDIA_FIELDS } from "../../constants.js";
import { ThreadsMedia, ThreadsReply, MetaPaginatedResponse } from "../../types.js";

export function registerThreadsDiscoveryTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Single Thread ─────────────────────────────────────────────────
  server.registerTool(
    "threads_get_post",
    {
      title: "Get Single Thread Post",
      description: `Gets details for a single Threads post by ID.

Args:
  - media_id (string): Threads media ID`,
      inputSchema: z
        .object({
          media_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ media_id, response_format }) => {
      try {
        const post = await client.threadsGet<ThreadsMedia>(`/${media_id}`, {
          fields: THREADS_MEDIA_FIELDS,
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(post, null, 2) }] };
        }

        const lines = [
          `# Thread \`${post.id}\``,
          "",
          post.username ? `- **Author**: @${post.username}` : "",
          post.text ? `- **Text**: ${post.text}` : "",
          post.media_type ? `- **Type**: ${post.media_type}` : "",
          post.timestamp ? `- **Posted**: ${formatDate(post.timestamp)}` : "",
          post.permalink ? `- **Link**: ${post.permalink}` : "",
          post.is_quote_post ? "- **Quote post**" : "",
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Conversation Tree ─────────────────────────────────────────────
  server.registerTool(
    "threads_get_conversation",
    {
      title: "Get Threads Conversation",
      description: `Gets the full conversation tree (all replies at all levels) for a Threads post.

Args:
  - media_id (string): Root thread media ID
  - reverse (boolean, optional): Reverse chronological order`,
      inputSchema: z
        .object({
          media_id: z.string(),
          reverse: z.boolean().default(false),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ media_id, reverse, response_format }) => {
      try {
        const data = await client.threadsGet<MetaPaginatedResponse<ThreadsReply>>(
          `/${media_id}/conversation`,
          { fields: "id,text,username,timestamp,media_type,hide_status", reverse }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No conversation found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Conversation for \`${media_id}\` (${data.data.length} posts)`, ""];
        for (const reply of data.data) {
          lines.push(`**@${reply.username ?? "unknown"}** (${formatDate(reply.timestamp)})`);
          if (reply.text) lines.push(`> ${reply.text}`);
          if (reply.hide_status === "HIDDEN") lines.push(`_[hidden]_`);
          lines.push(`_\`${reply.id}\`_`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "conversation") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Threads Mentions ──────────────────────────────────────────────
  server.registerTool(
    "threads_get_mentions",
    {
      title: "Get Threads Mentions",
      description: `Gets posts where the authenticated user was @mentioned.

Args:
  - threads_user_id (string): Threads user ID`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ threads_user_id, response_format }) => {
      try {
        const data = await client.threadsGet<MetaPaginatedResponse<ThreadsMedia>>(
          `/${threads_user_id}/mentions`,
          { fields: THREADS_MEDIA_FIELDS }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No mentions found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Threads Mentions (${data.data.length})`, ""];
        for (const post of data.data) {
          lines.push(`**@${post.username ?? "unknown"}** (${formatDate(post.timestamp)})`);
          if (post.text) lines.push(`> ${truncateField(post.text, 200)}`);
          if (post.permalink) lines.push(`- ${post.permalink}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "mentions") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Media Children ────────────────────────────────────────────────
  server.registerTool(
    "threads_get_media_children",
    {
      title: "Get Threads Carousel Items",
      description: `Gets individual items in a Threads carousel post.

Args:
  - media_id (string): Carousel media ID`,
      inputSchema: z
        .object({
          media_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ media_id, response_format }) => {
      try {
        const data = await client.threadsGet<{ data: ThreadsMedia[] }>(
          `/${media_id}/children`,
          { fields: THREADS_MEDIA_FIELDS }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No children found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Carousel Items (${data.data.length})`, ""];
        for (const child of data.data) {
          lines.push(`- \`${child.id}\` — ${child.media_type ?? "UNKNOWN"}${child.media_url ? ` | ${child.media_url}` : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Repost Thread ─────────────────────────────────────────────────────
  server.registerTool(
    "threads_repost",
    {
      title: "Repost a Thread",
      description: `Reposts (shares) an existing thread to your profile.

Args:
  - media_id (string): Thread media ID to repost`,
      inputSchema: z
        .object({
          media_id: z.string().describe("Thread ID to repost"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ media_id, response_format }) => {
      try {
        const result = await client.threadsPost<{ id: string }>(
          `/${media_id}/repost`
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Reposted.\n\n- **Repost ID**: \`${result.id}\`` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Threads Keyword Search ────────────────────────────────────────────
  server.registerTool(
    "threads_search",
    {
      title: "Search Threads by Keyword",
      description: `Searches Threads posts by keyword.

Args:
  - q (string): Search query
  - search_type (string): TOP or RECENT (default TOP)
  - limit (number): Max results (default 20)

Requires: threads_keyword_search permission.`,
      inputSchema: z
        .object({
          q: z.string().min(1).describe("Search query"),
          search_type: z.enum(["TOP", "RECENT"]).default("TOP"),
          limit: z.number().int().min(1).max(50).default(20),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ q, search_type, limit, response_format }) => {
      try {
        const data = await client.threadsGet<MetaPaginatedResponse<ThreadsMedia>>(
          "/keyword_search",
          { fields: THREADS_MEDIA_FIELDS, limit, q, search_type }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: `No threads found for "${q}".` }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Threads Search: "${q}" (${data.data.length})`, ""];
        for (const post of data.data) {
          lines.push(`## \`${post.id}\``);
          if (post.text) lines.push(`> ${truncateField(post.text, 200)}`);
          if (post.timestamp) lines.push(`- ${formatDate(post.timestamp)}`);
          if (post.permalink) lines.push(`- ${post.permalink}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "search results") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
