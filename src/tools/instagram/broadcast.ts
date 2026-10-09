import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatNumber, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { MetaPaginatedResponse } from "../../types.js";

export function registerInstagramBroadcastTools(server: McpServer, client: MetaApiClient): void {
  // ─── List Broadcast Channels ──────────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_broadcast_channels",
    {
      title: "List Instagram Broadcast Channels",
      description: `Lists broadcast channels for an Instagram professional account.

Broadcast channels enable one-to-many messaging from creators/brands to subscribers.

Args:
  - ig_account_id (string): Instagram account ID

Returns: Channel IDs, names, descriptions, subscriber counts.`,
      inputSchema: z
        .object({
          ig_account_id: z.string().describe("Instagram account ID"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ ig_account_id, response_format }) => {
      try {
        const data = await client.get<{ data: Array<{ id: string; name: string; description?: string; subscriber_count?: number; created_time?: string }> }>(
          `/${ig_account_id}/broadcast_channels`,
          { fields: "id,name,description,subscriber_count,created_time" }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No broadcast channels found for this account." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Broadcast Channels (${data.data.length})`, ""];
        for (const ch of data.data) {
          lines.push(`## ${ch.name} (\`${ch.id}\`)`);
          if (ch.description) lines.push(`- **Description**: ${truncateField(ch.description, 150)}`);
          if (ch.subscriber_count !== undefined) lines.push(`- **Subscribers**: ${formatNumber(ch.subscriber_count)}`);
          if (ch.created_time) lines.push(`- **Created**: ${formatDate(ch.created_time)}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Broadcast Channel Messages ────────────────────────────────────
  server.registerTool(
    "meta_get_broadcast_channel_messages",
    {
      title: "Get Broadcast Channel Messages",
      description: `Gets messages in an Instagram broadcast channel.

Args:
  - channel_id (string): Broadcast channel ID
  - limit (number): Max messages (1–100, default 20)
  - after (string, optional): Pagination cursor

Returns: Paginated list of messages with type, content, and timestamps.`,
      inputSchema: z
        .object({
          channel_id: z.string().describe("Broadcast channel ID"),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional().describe("Pagination cursor"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ channel_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,message,created_time,message_type",
          limit,
        };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<{
          id: string;
          message?: string;
          created_time?: string;
          message_type?: string;
        }>>(`/${channel_id}/messages`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No messages in this broadcast channel." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Broadcast Channel Messages (${data.data.length})`, ""];
        for (const msg of data.data) {
          lines.push(`## ${msg.message_type ?? "MESSAGE"} \`${msg.id}\``);
          if (msg.created_time) lines.push(`- **Time**: ${formatDate(msg.created_time)}`);
          if (msg.message) lines.push(`- **Content**: ${truncateField(msg.message, 200)}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "broadcast messages") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Send Broadcast Channel Message ────────────────────────────────────
  server.registerTool(
    "meta_send_broadcast_channel_message",
    {
      title: "Send Broadcast Channel Message",
      description: `Sends a message to an Instagram broadcast channel.

Args:
  - channel_id (string): Broadcast channel ID
  - message (string): Message text to send
  - link_url (string, optional): Clickable link to include with the message

Returns: Message ID of the sent message.`,
      inputSchema: z
        .object({
          channel_id: z.string().describe("Broadcast channel ID"),
          message: z.string().min(1).describe("Message text"),
          link_url: z.string().url().optional().describe("Optional clickable link URL"),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ channel_id, message, link_url }) => {
      try {
        const fields: Record<string, unknown> = { message };
        if (link_url) fields.link_url = link_url;

        const result = await client.post<{ id: string }>(`/${channel_id}/messages`, fields);

        return {
          content: [{
            type: "text",
            text: `Broadcast message sent successfully.\n\n- **Message ID**: \`${result.id}\``,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Broadcast Channel Poll ─────────────────────────────────────
  server.registerTool(
    "meta_create_broadcast_channel_poll",
    {
      title: "Create Broadcast Channel Poll",
      description: `Creates a poll in an Instagram broadcast channel.

Args:
  - channel_id (string): Broadcast channel ID
  - question (string): Poll question
  - options (string[]): Poll options (2–4 items)

Returns: Poll/message ID.`,
      inputSchema: z
        .object({
          channel_id: z.string().describe("Broadcast channel ID"),
          question: z.string().min(1).describe("Poll question"),
          options: z.array(z.string()).min(2).max(4).describe("Poll options (2–4 items)"),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ channel_id, question, options }) => {
      try {
        const result = await client.post<{ id: string }>(`/${channel_id}/messages`, {
          message_type: "POLL",
          poll: { question, options },
        });

        return {
          content: [{
            type: "text",
            text: `Poll created successfully.\n\n- **Poll ID**: \`${result.id}\`\n- **Question**: ${question}\n- **Options**: ${options.join(", ")}`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Hide/Unhide Instagram Comment ──────────────────────────────────────
  server.registerTool(
    "meta_hide_instagram_comment",
    {
      title: "Hide or Unhide an Instagram Comment",
      description: `Hides or unhides a comment on an Instagram media object.

Hidden comments are only visible to the comment author. This is a non-destructive alternative to deletion — useful for moderation.

Args:
  - comment_id (string): Comment ID to hide/unhide
  - is_hidden (boolean): true to hide, false to unhide`,
      inputSchema: z
        .object({
          comment_id: z.string().describe("Comment ID to hide/unhide"),
          is_hidden: z.boolean().describe("true to hide, false to unhide"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ comment_id, is_hidden }) => {
      try {
        await client.post(`/${comment_id}`, { hide: is_hidden });
        return {
          content: [{ type: "text", text: `Comment \`${comment_id}\` ${is_hidden ? "hidden" : "unhidden"} successfully.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
