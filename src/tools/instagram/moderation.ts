import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, formatDate, ResponseFormatSchema } from "../../services/utils.js";
import { InstagramComment, MetaPaginatedResponse } from "../../types.js";

export function registerInstagramCommentTools(server: McpServer, client: MetaApiClient): void {
  // ─── Delete Instagram Media ────────────────────────────────────────────
  server.registerTool(
    "meta_delete_instagram_media",
    {
      title: "Delete Instagram Media",
      description: `Deletes an Instagram media object (post, reel, story). This is permanent.

Args:
  - media_id (string): Instagram media ID to delete`,
      inputSchema: z
        .object({
          media_id: z.string().describe("Instagram media ID"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ media_id }) => {
      try {
        const result = await client.delete<{ success: boolean }>(`/${media_id}`);
        return {
          content: [
            {
              type: "text",
              text: result.success
                ? `Media \`${media_id}\` deleted.`
                : `Failed to delete media \`${media_id}\`.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Toggle Instagram Comments ─────────────────────────────────────────
  server.registerTool(
    "meta_toggle_instagram_comments",
    {
      title: "Toggle Instagram Comments",
      description: `Enables or disables comments on an Instagram media object.

Args:
  - media_id (string): Instagram media ID
  - enabled (boolean): true to enable comments, false to disable`,
      inputSchema: z
        .object({
          media_id: z.string().describe("Instagram media ID"),
          enabled: z.boolean().describe("Enable (true) or disable (false) comments"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ media_id, enabled }) => {
      try {
        await client.post(`/${media_id}`, { comment_enabled: enabled });
        return {
          content: [
            {
              type: "text",
              text: `Comments ${enabled ? "enabled" : "disabled"} on media \`${media_id}\`.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delete Comment ───────────────────────────────────────────────────────
  server.registerTool(
    "meta_delete_instagram_comment",
    {
      title: "Delete Instagram Comment",
      description: `Deletes a comment on an Instagram media object. This is permanent.

Args:
  - comment_id (string): The comment ID to delete`,
      inputSchema: z
        .object({
          comment_id: z.string().describe("Comment ID to delete"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ comment_id }) => {
      try {
        const result = await client.delete<{ success: boolean }>(`/${comment_id}`);
        return {
          content: [
            {
              type: "text",
              text: result.success
                ? `Comment \`${comment_id}\` deleted.`
                : `Failed to delete comment \`${comment_id}\`.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Comment Replies ───────────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_comment_replies",
    {
      title: "Get Instagram Comment Replies",
      description: `Gets replies to a specific Instagram comment.

Args:
  - comment_id (string): Parent comment ID
  - limit (number): Max replies (1–50, default 20)`,
      inputSchema: z
        .object({
          comment_id: z.string(),
          limit: z.number().int().min(1).max(50).default(20),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ comment_id, limit, response_format }) => {
      try {
        const data = await client.get<MetaPaginatedResponse<InstagramComment>>(
          `/${comment_id}/replies`,
          { fields: "id,text,username,timestamp,from", limit }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No replies on this comment." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Replies to \`${comment_id}\` (${data.data.length})`, ""];
        for (const r of data.data) {
          lines.push(`**@${r.username ?? r.from?.username ?? "unknown"}** (${formatDate(r.timestamp)})`);
          lines.push(`> ${r.text}`);
          lines.push(`_ID: \`${r.id}\`_`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "replies") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
