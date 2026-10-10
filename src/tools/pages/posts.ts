import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatNumber, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { PAGE_FIELDS, PAGE_FIELDS_WITH_TOKEN, POST_FIELDS } from "../../constants.js";
import { MetaPage, MetaPost, MetaPaginatedResponse } from "../../types.js";

export function registerPagePostTools(server: McpServer, client: MetaApiClient): void {
  // ─── List Pages ───────────────────────────────────────────────────────────
  server.registerTool(
    "meta_list_pages",
    {
      title: "List Facebook Pages",
      description: `Lists all Facebook Pages managed by the authenticated user.

IMPORTANT: Call this tool first before any page or Instagram operations — it caches the page access tokens needed for subsequent calls.

Returns:
- id: Page ID (needed for other tools)
- name: Page name
- category: Page category
- fan_count: Number of likes
- followers_count: Number of followers
- link: Page URL
- instagram_business_account.id: Linked Instagram account ID (if any)

Tip: The page tokens are cached automatically. You do not need to manage them manually.`,
      inputSchema: z
        .object({
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ response_format }) => {
      try {
        const data = await client.get<MetaPaginatedResponse<MetaPage>>("/me/accounts", {
          fields: PAGE_FIELDS_WITH_TOKEN,
        });

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No pages found for this account." }] };
        }

        for (const page of data.data) {
          if (page.access_token) {
            client.cachePageToken(page.id, page.access_token);
          }
        }

        if (response_format === "json") {
          const safePages = data.data.map(({ access_token: _accessToken, ...page }) => page);
          return {
            content: [{ type: "text", text: JSON.stringify(safePages, null, 2) }],
          };
        }

        const lines = [
          `# Your Facebook Pages (${data.data.length})`,
          "",
          "_Page tokens cached — you can now call page and Instagram tools._",
          "",
        ];
        for (const page of data.data) {
          lines.push(`## ${page.name} (\`${page.id}\`)`);
          lines.push(`- **Category**: ${page.category ?? "N/A"}`);
          lines.push(`- **Followers**: ${formatNumber(page.followers_count)}`);
          lines.push(`- **Likes (fans)**: ${formatNumber(page.fan_count)}`);
          if (page.link) lines.push(`- **URL**: ${page.link}`);
          if (page.instagram_business_account)
            lines.push(`- **Instagram Account ID**: \`${page.instagram_business_account.id}\``);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "pages") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Page ─────────────────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page",
    {
      title: "Get Facebook Page Details",
      description: `Gets detailed information about a specific Facebook Page.

Args:
  - page_id (string): The Facebook Page ID

Returns page details including name, category, description, follower counts, and linked Instagram account.`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ page_id, response_format }) => {
      try {
        const page = await client.get<MetaPage>(`/${page_id}`, {
          fields: PAGE_FIELDS_WITH_TOKEN,
        });

        if (page.access_token) {
          client.cachePageToken(page_id, page.access_token);
        }

        if (response_format === "json") {
          const { access_token: _accessToken, ...safePage } = page;
          return { content: [{ type: "text", text: JSON.stringify(safePage, null, 2) }] };
        }

        const lines = [
          `# ${page.name}`,
          "",
          `- **ID**: \`${page.id}\``,
          `- **Category**: ${page.category ?? "N/A"}`,
          `- **Followers**: ${formatNumber(page.followers_count)}`,
          `- **Likes**: ${formatNumber(page.fan_count)}`,
          page.link ? `- **URL**: ${page.link}` : "",
          page.description ? `- **Description**: ${page.description}` : "",
          page.about ? `- **About**: ${page.about}` : "",
          page.instagram_business_account
            ? `- **Instagram Account**: \`${page.instagram_business_account.id}\``
            : "- **Instagram**: Not linked",
        ]
          .filter(Boolean)
          .join("\n");
        return { content: [{ type: "text", text: lines }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Post ──────────────────────────────────────────────────────────
  server.registerTool(
    "meta_create_post",
    {
      title: "Create Facebook Page Post",
      description: `Creates a new post on a Facebook Page.

Requires: meta_list_pages must be called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID to post to
  - message (string): Text content of the post
  - link (string, optional): URL to attach to the post (creates a link preview)
  - published (boolean, optional): If false, saves as draft. Default true.
  - scheduled_publish_time (number, optional): Unix timestamp for scheduling (must be 10 min to 30 days in future; published must be false)

Returns: Post ID of the created post.

Notes:
  - Maximum post length: ~63,206 characters
  - Scheduling requires the page to have Page Publishing Authorization`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          message: z.string().min(1).describe("Post text content"),
          link: z.string().url().optional().describe("Optional URL to share"),
          published: z
            .boolean()
            .default(true)
            .describe("Publish immediately (true) or save as draft (false)"),
          scheduled_publish_time: z
            .number()
            .int()
            .optional()
            .describe("Unix timestamp to schedule the post (requires published=false)"),
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
    async ({ page_id, message, link, published, scheduled_publish_time, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const fields: Record<string, unknown> = { message, published };
        if (link) fields.link = link;
        if (scheduled_publish_time) fields.scheduled_publish_time = scheduled_publish_time;

        const result = await client.post<{ id: string }>(
          `/${page_id}/feed`,
          fields,
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        const status = scheduled_publish_time ? "scheduled" : published ? "published" : "saved as draft";
        return {
          content: [
            {
              type: "text",
              text: `Post ${status} successfully.\n\n- **Post ID**: \`${result.id}\``,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Posts ────────────────────────────────────────────────────────────
  server.registerTool(
    "meta_get_posts",
    {
      title: "Get Facebook Page Posts",
      description: `Lists posts from a Facebook Page feed.

Requires: meta_list_pages called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max posts to return (1–100, default 20)
  - after (string, optional): Cursor for next page of results

Returns: List of posts with message, permalink, created time, and post ID.`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional().describe("Pagination cursor for next page"),
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
          fields: POST_FIELDS,
          limit,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<MetaPost>>(
          `/${page_id}/feed`,
          pageToken,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No posts found on this page." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Page Posts (${data.data.length} shown)`, ""];
        for (const post of data.data) {
          lines.push(`## Post \`${post.id}\``);
          lines.push(`- **Created**: ${formatDate(post.created_time)}`);
          if (post.message) lines.push(`- **Message**: ${truncateField(post.message, 200)}`);
          if (post.story) lines.push(`- **Story**: ${post.story}`);
          if (post.permalink_url) lines.push(`- **Link**: ${post.permalink_url}`);
          lines.push("");
        }
        if (nextCursor) {
          lines.push(buildPaginationNote(data.data.length, nextCursor));
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "posts") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delete Post ──────────────────────────────────────────────────────────
  server.registerTool(
    "meta_delete_post",
    {
      title: "Delete Facebook Page Post",
      description: `Deletes a post from a Facebook Page. This action is permanent and cannot be undone.

Args:
  - post_id (string): The post ID to delete (format: {page_id}_{post_id})
  - page_id (string): The Page ID (for authentication)`,
      inputSchema: z
        .object({
          post_id: z
            .string()
            .describe("Post ID to delete (get from meta_get_posts)"),
          page_id: z.string().describe("Page ID (for token — call meta_list_pages first)"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ post_id, page_id }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const result = await client.delete<{ success: boolean }>(`/${post_id}`, pageToken);
        return {
          content: [
            {
              type: "text",
              text: result.success
                ? `Post \`${post_id}\` deleted successfully.`
                : `Failed to delete post \`${post_id}\`.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Photo Post ──────────────────────────────────────────────────
  server.registerTool(
    "meta_create_photo_post",
    {
      title: "Create Facebook Photo Post",
      description: `Publishes a photo post to a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - url (string): Public URL of the image
  - caption (string, optional): Photo caption/message
  - published (boolean): Default true`,
      inputSchema: z
        .object({
          page_id: z.string(),
          url: z.string().url().describe("Public image URL"),
          caption: z.string().optional(),
          published: z.boolean().default(true),
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
    async ({ page_id, url, caption, published, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const fields: Record<string, unknown> = { url, published };
        if (caption) fields.message = caption;

        const result = await client.post<{ id: string; post_id?: string }>(
          `/${page_id}/photos`,
          fields,
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `Photo posted.\n\n- **Photo ID**: \`${result.id}\`${result.post_id ? `\n- **Post ID**: \`${result.post_id}\`` : ""}`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Video Post ─────────────────────────────────────────────────
  server.registerTool(
    "meta_create_video_post",
    {
      title: "Create Facebook Video Post",
      description: `Publishes a video post to a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - file_url (string): Public URL of the video file
  - title (string, optional): Video title
  - description (string, optional): Video description`,
      inputSchema: z
        .object({
          page_id: z.string(),
          file_url: z.string().url().describe("Public video URL"),
          title: z.string().optional(),
          description: z.string().optional(),
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
    async ({ page_id, file_url, title, description, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const fields: Record<string, unknown> = { file_url };
        if (title) fields.title = title;
        if (description) fields.description = description;

        const result = await client.post<{ id: string }>(
          `/${page_id}/videos`,
          fields,
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{ type: "text", text: `Video posted.\n\n- **Video ID**: \`${result.id}\`` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
