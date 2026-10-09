import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { MetaPaginatedResponse } from "../../types.js";

export function registerPageCommentTools(server: McpServer, client: MetaApiClient): void {
  // ─── Update Page Settings ──────────────────────────────────────────────
  server.registerTool(
    "meta_update_page",
    {
      title: "Update Facebook Page Settings",
      description: `Updates a Facebook Page's profile information.

Args:
  - page_id (string): Facebook Page ID
  - about (string, optional): Short description (max 255 chars)
  - description (string, optional): Long description
  - website (string, optional): Website URL
  - phone (string, optional): Phone number
  - emails (string[], optional): Contact emails
  - hours (object, optional): Business hours as key-value pairs (e.g., {"mon_1_open":"09:00","mon_1_close":"17:00"})
  - category (string, optional): Page category (e.g., "Restaurant")
  - username (string, optional): Page username/vanity URL
  - contact_address (object, optional): Mailing address with street, city, state, zip, country

Requires pages_manage_metadata permission.`,
      inputSchema: z
        .object({
          page_id: z.string(),
          about: z.string().max(255).optional(),
          description: z.string().optional(),
          website: z.string().url().optional(),
          phone: z.string().optional(),
          emails: z.array(z.string().email()).optional(),
          hours: z.record(z.string()).optional().describe("Business hours key-value pairs"),
          category: z.string().optional().describe("Page category"),
          username: z.string().optional().describe("Page vanity URL/username"),
          contact_address: z.object({
            street: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            zip: z.string().optional(),
            country: z.string().optional(),
          }).optional().describe("Mailing/contact address"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ page_id, about, description, website, phone, emails, hours, category, username, contact_address }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const fields: Record<string, unknown> = {};
        if (about !== undefined) fields.about = about;
        if (description !== undefined) fields.description = description;
        if (website !== undefined) fields.website = website;
        if (phone !== undefined) fields.phone = phone;
        if (emails !== undefined) fields.emails = emails;
        if (hours !== undefined) fields.hours = hours;
        if (category !== undefined) fields.category = category;
        if (username !== undefined) fields.username = username;
        if (contact_address !== undefined) fields.contact_address = contact_address;

        if (Object.keys(fields).length === 0) {
          return { content: [{ type: "text", text: "Error: Provide at least one field to update." }], isError: true };
        }

        await client.post(`/${page_id}`, fields, pageToken);
        return {
          content: [{ type: "text", text: `Page \`${page_id}\` updated successfully.\n\nFields updated: ${Object.keys(fields).join(", ")}` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Post Comments ─────────────────────────────────────────────────
  server.registerTool(
    "meta_get_post_comments",
    {
      title: "Get Post Comments",
      description: `Gets comments on a Facebook Page post.

Args:
  - post_id (string): Post ID (format: {page_id}_{post_id})
  - page_id (string): Page ID (for authentication — call meta_list_pages first)
  - limit (number): Max comments (1–100, default 25)
  - order (string): 'chronological' or 'reverse_chronological'
  - after (string, optional): Pagination cursor
  - filter (string): 'toplevel' (default), 'stream' (all including replies)`,
      inputSchema: z
        .object({
          post_id: z.string(),
          page_id: z.string().describe("Page ID (call meta_list_pages first)"),
          limit: z.number().int().min(1).max(100).default(25),
          order: z.enum(["chronological", "reverse_chronological"]).default("reverse_chronological"),
          filter: z.enum(["toplevel", "stream"]).default("toplevel"),
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
    async ({ post_id, page_id, limit, order, filter, after, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const params: Record<string, unknown> = {
          fields: "id,message,from,created_time,like_count,comment_count,parent",
          limit,
          order,
          filter,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string;
          message: string;
          from: { name: string; id: string };
          created_time: string;
          like_count?: number;
          comment_count?: number;
          parent?: { id: string };
        }>>(`/${post_id}/comments`, pageToken, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No comments on this post." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Comments on \`${post_id}\` (${data.data.length})`, ""];
        for (const c of data.data) {
          const indent = c.parent ? "  " : "";
          lines.push(`${indent}**${c.from?.name ?? "Unknown"}** (${formatDate(c.created_time)})`);
          lines.push(`${indent}> ${c.message}`);
          lines.push(`${indent}_ID: \`${c.id}\` | Likes: ${c.like_count ?? 0} | Replies: ${c.comment_count ?? 0}_`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "comments") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Reply to Post Comment ─────────────────────────────────────────────
  server.registerTool(
    "meta_reply_post_comment",
    {
      title: "Reply to Post Comment",
      description: `Replies to a comment on a Facebook Page post.

Args:
  - comment_id (string): Comment ID to reply to
  - page_id (string): Page ID (for token lookup)
  - message (string): Reply text`,
      inputSchema: z
        .object({
          comment_id: z.string(),
          page_id: z.string(),
          message: z.string().min(1),
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
    async ({ comment_id, page_id, message, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const result = await client.post<{ id: string }>(
          `/${comment_id}/comments`,
          { message },
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{ type: "text", text: `Reply posted.\n\n- **Comment ID**: \`${result.id}\`` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delete Comment ────────────────────────────────────────────────────
  server.registerTool(
    "meta_delete_comment",
    {
      title: "Delete Facebook Comment",
      description: `Deletes a comment on a Facebook Page post. Permanent action.

Args:
  - comment_id (string): Comment ID to delete
  - page_id (string): Page ID (for authentication)`,
      inputSchema: z
        .object({
          comment_id: z.string(),
          page_id: z.string().describe("Page ID (call meta_list_pages first)"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ comment_id, page_id }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const result = await client.delete<{ success: boolean }>(`/${comment_id}`, pageToken);
        return {
          content: [{
            type: "text",
            text: result.success ? `Comment \`${comment_id}\` deleted.` : `Failed to delete comment \`${comment_id}\`.`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Like/Unlike Post or Comment ───────────────────────────────────────
  server.registerTool(
    "meta_like_object",
    {
      title: "Like/Unlike Post or Comment",
      description: `Likes or removes a like from a page post or comment, acting as the Page.

Args:
  - object_id (string): Post ID or Comment ID
  - page_id (string): Page ID (for token)
  - unlike (boolean): If true, removes the like instead`,
      inputSchema: z
        .object({
          object_id: z.string().describe("Post ID or Comment ID"),
          page_id: z.string(),
          unlike: z.boolean().default(false),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ object_id, page_id, unlike }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        if (unlike) {
          await client.delete(`/${object_id}/likes`, pageToken);
        } else {
          await client.post(`/${object_id}/likes`, {}, pageToken);
        }
        return {
          content: [{ type: "text", text: unlike ? `Unliked \`${object_id}\`.` : `Liked \`${object_id}\`.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
