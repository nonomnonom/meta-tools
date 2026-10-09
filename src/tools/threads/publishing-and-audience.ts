import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { MetaPaginatedResponse } from "../../types.js";

export function registerThreadsExtendedPublishingTools(server: McpServer, client: MetaApiClient): void {
  // ─── Publish GIF Thread ────────────────────────────────────────────────
  server.registerTool(
    "threads_publish_gif",
    {
      title: "Publish GIF Thread",
      description: `Publishes a GIF post to Threads using a GIPHY URL.

Two-step flow: creates a container, then publishes it.

Args:
  - threads_user_id (string): Threads user ID
  - gif_url (string): GIPHY URL of the GIF
  - text (string, optional): Caption text
  - reply_to_id (string, optional): Thread ID to reply to
  - reply_control (enum, optional): Who can reply — everyone, accounts_you_follow, or mentioned_only

Returns: Media ID of the published thread.`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
          gif_url: z.string().url().describe("GIPHY URL of the GIF"),
          text: z.string().optional().describe("Caption text"),
          reply_to_id: z.string().optional().describe("Thread ID to reply to"),
          reply_control: z.enum(["everyone", "accounts_you_follow", "mentioned_only"]).optional().describe("Who can reply to this post"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ threads_user_id, gif_url, text, reply_to_id, reply_control, response_format }) => {
      try {
        const fields: Record<string, unknown> = { media_type: "IMAGE", image_url: gif_url };
        if (text) fields.text = text;
        if (reply_to_id) fields.reply_to_id = reply_to_id;
        if (reply_control) fields.reply_control = reply_control;

        const container = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads`,
          fields
        );

        const result = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads_publish`,
          { creation_id: container.id }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{ type: "text", text: `GIF thread published.\n\n- **Media ID**: \`${result.id}\`` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Link Thread ───────────────────────────────────────────────
  server.registerTool(
    "threads_publish_link",
    {
      title: "Publish Link Thread",
      description: `Publishes a thread post with a link attachment.

Args:
  - threads_user_id (string): Threads user ID
  - text (string): Post text containing the URL
  - link_attachment (string): URL to attach as a link preview`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
          text: z.string().min(1),
          link_attachment: z.string().url().describe("URL for link preview"),
          reply_control: z.enum(["everyone", "accounts_you_follow", "mentioned_only"]).optional().describe("Who can reply to this post"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ threads_user_id, text, link_attachment, reply_control, response_format }) => {
      try {
        const fields: Record<string, unknown> = { media_type: "TEXT", text, link_attachment };
        if (reply_control) fields.reply_control = reply_control;

        const container = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads`,
          fields
        );

        const result = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads_publish`,
          { creation_id: container.id }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Link thread published.\n\n- **Media ID**: \`${result.id}\`` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Threads Followers ──────────────────────────────────────────────
  server.registerTool(
    "threads_get_followers",
    {
      title: "Get Threads Followers",
      description: `Lists followers of the authenticated Threads user.

Args:
  - threads_user_id (string): Threads user ID
  - limit (number): Max results (1–100, default 25)
  - after (string, optional): Pagination cursor

Returns: User IDs, usernames, and profile picture URLs of followers.

Note: Requires threads_basic scope. Only returns users who have allowed their followers list to be visible.`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
          limit: z.number().int().min(1).max(100).default(25),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ threads_user_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,username,threads_profile_picture_url",
          limit,
        };
        if (after) params.after = after;

        const data = await client.threadsGet<MetaPaginatedResponse<{
          id: string;
          username?: string;
          threads_profile_picture_url?: string;
        }>>(`/${threads_user_id}/followers`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No followers found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Threads Followers (${data.data.length} shown)`, ""];
        for (const user of data.data) {
          lines.push(`- **@${user.username ?? "unknown"}** (\`${user.id}\`)`);
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Threads Following ──────────────────────────────────────────────
  server.registerTool(
    "threads_get_following",
    {
      title: "Get Threads Following",
      description: `Lists accounts that the authenticated Threads user is following.

Args:
  - threads_user_id (string): Threads user ID
  - limit (number): Max results (1–100, default 25)
  - after (string, optional): Pagination cursor

Returns: User IDs, usernames, and profile pictures of followed accounts.`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
          limit: z.number().int().min(1).max(100).default(25),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ threads_user_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,username,threads_profile_picture_url",
          limit,
        };
        if (after) params.after = after;

        const data = await client.threadsGet<MetaPaginatedResponse<{
          id: string;
          username?: string;
          threads_profile_picture_url?: string;
        }>>(`/${threads_user_id}/following`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No following found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Threads Following (${data.data.length} shown)`, ""];
        for (const user of data.data) {
          lines.push(`- **@${user.username ?? "unknown"}** (\`${user.id}\`)`);
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
