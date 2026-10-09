import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { MetaPaginatedResponse } from "../../types.js";

export function registerInstagramDirectMessageTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Instagram DM Conversations ─────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_conversations",
    {
      title: "List Instagram DM Conversations",
      description: `Lists Instagram Direct Message conversations.

Args:
  - ig_account_id (string): Instagram account ID
  - folder (string): 'inbox' (default), 'spam', or 'general'
  - limit (number): Max conversations (1–100, default 20)
  - after (string, optional): Pagination cursor

Requires instagram_manage_messages permission. Uses user token (not page token).`,
      inputSchema: z
        .object({
          ig_account_id: z.string().describe("Instagram account ID"),
          folder: z.enum(["inbox", "spam", "general"]).default("inbox").describe("Conversation folder"),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional().describe("Pagination cursor"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ig_account_id, folder, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,updated_time,participants,messages.limit(1){message,from,created_time}",
          folder,
          limit,
        };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<{
          id: string;
          updated_time: string;
          participants: { data: Array<{ id: string; username?: string; name?: string }> };
          messages?: { data: Array<{ message: string; from: { id: string; username?: string; name?: string }; created_time: string }> };
        }>>(`/${ig_account_id}/conversations`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: `No conversations found in ${folder}.` }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Instagram DM Conversations — ${folder} (${data.data.length})`, ""];
        for (const conv of data.data) {
          const participants = conv.participants?.data?.map((p) => p.username ?? p.name ?? p.id).join(", ") ?? "Unknown";
          const lastMsg = conv.messages?.data?.[0];
          lines.push(`## Conversation \`${conv.id}\``);
          lines.push(`- **Participants**: ${participants}`);
          lines.push(`- **Updated**: ${formatDate(conv.updated_time)}`);
          if (lastMsg) {
            const sender = lastMsg.from?.username ?? lastMsg.from?.name ?? lastMsg.from?.id ?? "Unknown";
            lines.push(`- **Last message**: ${sender}: ${truncateField(lastMsg.message, 100)}`);
          }
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "conversations") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Instagram DM Messages ────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_messages",
    {
      title: "Get Instagram DM Messages",
      description: `Gets messages in an Instagram Direct Message conversation.

Args:
  - conversation_id (string): Conversation ID (from meta_get_instagram_conversations)
  - limit (number): Max messages (1–100, default 20)
  - after (string, optional): Pagination cursor

Messages are returned in reverse chronological order from the API and displayed in chronological order.`,
      inputSchema: z
        .object({
          conversation_id: z.string().describe("Conversation ID"),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional().describe("Pagination cursor"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ conversation_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,message,from,created_time,attachments",
          limit,
        };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<{
          id: string;
          message: string;
          from: { id: string; username?: string; name?: string };
          created_time: string;
          attachments?: { data: Array<{ type: string; url?: string; name?: string }> };
        }>>(`/${conversation_id}/messages`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No messages in this conversation." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        // Reverse to chronological order
        const messages = [...data.data].reverse();
        const lines = [`# Messages in \`${conversation_id}\` (${data.data.length})`, ""];
        for (const msg of messages) {
          const sender = msg.from?.username ?? msg.from?.name ?? msg.from?.id ?? "Unknown";
          lines.push(`**${sender}** (${formatDate(msg.created_time)})`);
          if (msg.message) lines.push(`> ${msg.message}`);
          if (msg.attachments?.data?.length) {
            for (const att of msg.attachments.data) {
              lines.push(`- _Attachment_: ${att.type}${att.url ? ` — ${att.url}` : ""}`);
            }
          }
          lines.push(`_ID: \`${msg.id}\`_`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "messages") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Send Instagram DM ────────────────────────────────────────────────
  server.registerTool(
    "meta_send_instagram_message",
    {
      title: "Send Instagram Direct Message",
      description: `Sends a text DM to an Instagram user.

Args:
  - ig_account_id (string): Instagram account ID (sender)
  - recipient_id (string): Instagram-scoped user ID of the recipient
  - message (string): Text message to send

Note: Only works within the 24-hour human agent messaging window or 7-day standard messaging window. The recipient must have messaged the account first.

Returns: Message ID.`,
      inputSchema: z
        .object({
          ig_account_id: z.string().describe("Instagram account ID"),
          recipient_id: z.string().describe("Instagram-scoped user ID of recipient"),
          message: z.string().min(1).describe("Message text"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ig_account_id, recipient_id, message, response_format }) => {
      try {
        const result = await client.post<{ recipient_id: string; message_id: string }>(
          `/${ig_account_id}/messages`,
          {
            recipient: { id: recipient_id },
            message: { text: message },
          }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `Message sent successfully.\n\n- **Message ID**: \`${result.message_id}\`\n- **Recipient**: \`${result.recipient_id ?? recipient_id}\``,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Send Instagram Media DM ──────────────────────────────────────────
  server.registerTool(
    "meta_send_instagram_media_message",
    {
      title: "Send Instagram Media DM",
      description: `Sends an image or link via Instagram Direct Message.

Args:
  - ig_account_id (string): Instagram account ID (sender)
  - recipient_id (string): Instagram-scoped user ID of recipient
  - image_url (string, optional): URL of image to send
  - link_url (string, optional): URL of link to send (as a generic template)

Provide either image_url or link_url (not both). Same messaging window restrictions as text DMs.

Returns: Message ID.`,
      inputSchema: z
        .object({
          ig_account_id: z.string().describe("Instagram account ID"),
          recipient_id: z.string().describe("Instagram-scoped user ID of recipient"),
          image_url: z.string().url().optional().describe("URL of image to send"),
          link_url: z.string().url().optional().describe("URL of link to send"),
          response_format: ResponseFormatSchema,
        })
        .strict()
        .refine((data) => data.image_url || data.link_url, {
          message: "Either image_url or link_url must be provided",
        }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ig_account_id, recipient_id, image_url, link_url, response_format }) => {
      try {
        let messagePayload: Record<string, unknown>;

        if (image_url) {
          messagePayload = {
            attachment: { type: "image", payload: { url: image_url } },
          };
        } else {
          messagePayload = {
            attachment: {
              type: "template",
              payload: {
                template_type: "generic",
                elements: [{ title: "Link", default_action: { type: "web_url", url: link_url } }],
              },
            },
          };
        }

        const result = await client.post<{ recipient_id: string; message_id: string }>(
          `/${ig_account_id}/messages`,
          {
            recipient: { id: recipient_id },
            message: messagePayload,
          }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        const mediaType = image_url ? "Image" : "Link";
        return {
          content: [{
            type: "text",
            text: `${mediaType} message sent successfully.\n\n- **Message ID**: \`${result.message_id}\`\n- **Recipient**: \`${result.recipient_id ?? recipient_id}\``,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
