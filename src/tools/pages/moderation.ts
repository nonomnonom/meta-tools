import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, ResponseFormatSchema } from "../../services/utils.js";
import { MetaPaginatedResponse } from "../../types.js";

export function registerPageModerationTools(server: McpServer, client: MetaApiClient): void {
  // ─── List Blocked Users ────────────────────────────────────────────────
  server.registerTool(
    "meta_get_blocked_users",
    {
      title: "Get Blocked Users",
      description: `Lists users blocked by the Facebook Page.

Args:
  - page_id (string): Facebook Page ID`,
      inputSchema: z
        .object({
          page_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ page_id, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const data = await client.getWithToken<MetaPaginatedResponse<{ id: string; name: string }>>(
          `/${page_id}/blocked`,
          pageToken,
          {}
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No blocked users." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Blocked Users (${data.data.length})`, ""];
        for (const user of data.data) {
          lines.push(`- **${user.name}** (\`${user.id}\`)`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Block/Unblock User ────────────────────────────────────────────────
  server.registerTool(
    "meta_block_user",
    {
      title: "Block/Unblock User from Page",
      description: `Blocks or unblocks a user from a Facebook Page. Blocked users cannot post or comment.

Args:
  - page_id (string): Facebook Page ID
  - user_id (string): User ID to block/unblock
  - unblock (boolean): If true, unblocks the user instead`,
      inputSchema: z
        .object({
          page_id: z.string(),
          user_id: z.string(),
          unblock: z.boolean().default(false),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ page_id, user_id, unblock }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        if (unblock) {
          // Meta unblock: DELETE /{page-id}/blocked?uid={user-id}
          await client.delete(`/${page_id}/blocked`, pageToken, { uid: user_id });
          return { content: [{ type: "text", text: `User \`${user_id}\` unblocked from page.` }] };
        } else {
          await client.post(`/${page_id}/blocked`, { uid: user_id }, pageToken);
          return { content: [{ type: "text", text: `User \`${user_id}\` blocked from page.` }] };
        }
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
