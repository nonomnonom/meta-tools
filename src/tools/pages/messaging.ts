import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { MetaPaginatedResponse } from "../../types.js";

export function registerPageMessagingTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Page Conversations ────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_conversations",
    {
      title: "Get Page Conversations",
      description: `Lists conversations (messages) in a Facebook Page inbox.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max conversations (1–100, default 20)
  - after (string, optional): Pagination cursor

Requires pages_messaging permission.`,
      inputSchema: z
        .object({
          page_id: z.string(),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ page_id, limit, after, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const params: Record<string, unknown> = {
          fields: "id,snippet,updated_time,message_count,participants",
          limit,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string;
          snippet: string;
          updated_time: string;
          message_count: number;
          participants: { data: Array<{ name: string; id: string }> };
        }>>(`/${page_id}/conversations`, pageToken, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No conversations found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Page Conversations (${data.data.length})`, ""];
        for (const convo of data.data) {
          const names = convo.participants?.data?.map((p) => p.name).join(", ") ?? "Unknown";
          lines.push(`## \`${convo.id}\``);
          lines.push(`- **With**: ${names}`);
          lines.push(`- **Last message**: ${convo.snippet ?? "N/A"}`);
          lines.push(`- **Messages**: ${convo.message_count}`);
          lines.push(`- **Updated**: ${formatDate(convo.updated_time)}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "conversations") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Conversation Messages ─────────────────────────────────────────
  server.registerTool(
    "meta_get_conversation_messages",
    {
      title: "Get Conversation Messages",
      description: `Gets messages from a specific Page conversation.

Args:
  - page_id (string): Facebook Page ID (for auth)
  - conversation_id (string): Conversation ID (from meta_get_page_conversations)
  - limit (number): Max messages (1–100, default 20)`,
      inputSchema: z
        .object({
          page_id: z.string(),
          conversation_id: z.string(),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ page_id, conversation_id, limit, after, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const params: Record<string, unknown> = {
          fields: "id,message,from,created_time,attachments",
          limit,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string;
          message: string;
          from: { name: string; id: string };
          created_time: string;
        }>>(`/${conversation_id}/messages`, pageToken, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No messages found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Messages (${data.data.length})`, ""];
        for (const msg of data.data) {
          lines.push(`**${msg.from?.name ?? "Unknown"}** (${formatDate(msg.created_time)})`);
          lines.push(`> ${msg.message ?? "[no text]"}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "messages") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Send Page Message ─────────────────────────────────────────────────
  server.registerTool(
    "meta_send_page_message",
    {
      title: "Send Page Message",
      description: `Sends a message from a Facebook Page to a user (in an existing conversation).

Args:
  - page_id (string): Facebook Page ID
  - recipient_id (string): PSID (page-scoped user ID) of the recipient
  - message (string): Message text

Requires pages_messaging permission. Only works within the 24-hour messaging window.`,
      inputSchema: z
        .object({
          page_id: z.string(),
          recipient_id: z.string().describe("Page-scoped user ID"),
          message: z.string().min(1),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ page_id, recipient_id, message }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const result = await client.post<{ recipient_id: string; message_id: string }>(
          `/${page_id}/messages`,
          {
            recipient: { id: recipient_id },
            message: { text: message },
            messaging_type: "RESPONSE",
          },
          pageToken
        );

        return {
          content: [{ type: "text", text: `Message sent.\n\n- **Message ID**: \`${result.message_id}\`` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
