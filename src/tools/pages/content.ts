import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatNumber, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { POST_FIELDS } from "../../constants.js";
import { MetaPost, MetaPaginatedResponse } from "../../types.js";

export function registerPageMediaTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Scheduled Posts ───────────────────────────────────────────────
  server.registerTool(
    "meta_get_scheduled_posts",
    {
      title: "Get Scheduled Posts",
      description: `Lists scheduled (unpublished) posts for a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max results (1–100, default 20)`,
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
          fields: POST_FIELDS + ",scheduled_publish_time,is_published",
          limit,
          is_published: false,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<MetaPost & {
          scheduled_publish_time?: string;
          is_published?: boolean;
        }>>(`/${page_id}/scheduled_posts`, pageToken, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No scheduled posts found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Scheduled Posts (${data.data.length})`, ""];
        for (const post of data.data) {
          lines.push(`## \`${post.id}\``);
          if (post.message) lines.push(`- **Message**: ${truncateField(post.message, 200)}`);
          if (post.scheduled_publish_time) lines.push(`- **Scheduled for**: ${formatDate(post.scheduled_publish_time)}`);
          lines.push(`- **Created**: ${formatDate(post.created_time)}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "scheduled posts") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Page Albums ───────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_albums",
    {
      title: "Get Page Photo Albums",
      description: `Lists photo albums on a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max results (1–100, default 20)`,
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
          fields: "id,name,description,count,type,created_time,link",
          limit,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string;
          name: string;
          description?: string;
          count?: number;
          type?: string;
          created_time?: string;
          link?: string;
        }>>(`/${page_id}/albums`, pageToken, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No albums found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Page Albums (${data.data.length})`, ""];
        for (const album of data.data) {
          lines.push(`## ${album.name} (\`${album.id}\`)`);
          if (album.count !== undefined) lines.push(`- **Photos**: ${album.count}`);
          if (album.type) lines.push(`- **Type**: ${album.type}`);
          if (album.description) lines.push(`- **Description**: ${album.description}`);
          if (album.created_time) lines.push(`- **Created**: ${formatDate(album.created_time)}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "albums") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Page Events ───────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_events",
    {
      title: "Get Page Events",
      description: `Lists events created by a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max results (1–100, default 20)
  - time_filter (string): 'upcoming' or 'past'`,
      inputSchema: z
        .object({
          page_id: z.string(),
          limit: z.number().int().min(1).max(100).default(20),
          time_filter: z.enum(["upcoming", "past"]).default("upcoming"),
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
    async ({ page_id, limit, time_filter, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string;
          name: string;
          description?: string;
          start_time?: string;
          end_time?: string;
          place?: { name: string };
          attending_count?: number;
          interested_count?: number;
        }>>(`/${page_id}/events`, pageToken, {
          fields: "id,name,description,start_time,end_time,place,attending_count,interested_count",
          limit,
          time_filter,
        });

        if (!data.data?.length) {
          return { content: [{ type: "text", text: `No ${time_filter} events found.` }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Page Events — ${time_filter} (${data.data.length})`, ""];
        for (const evt of data.data) {
          lines.push(`## ${evt.name} (\`${evt.id}\`)`);
          if (evt.start_time) lines.push(`- **Starts**: ${formatDate(evt.start_time)}`);
          if (evt.end_time) lines.push(`- **Ends**: ${formatDate(evt.end_time)}`);
          if (evt.place?.name) lines.push(`- **Location**: ${evt.place.name}`);
          if (evt.attending_count !== undefined) lines.push(`- **Attending**: ${formatNumber(evt.attending_count)} | **Interested**: ${formatNumber(evt.interested_count)}`);
          if (evt.description) lines.push(`- **Description**: ${truncateField(evt.description, 200)}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "events") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Page Tagged Posts ─────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_tagged",
    {
      title: "Get Page Tagged Posts",
      description: `Gets posts that tag this Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max results (1–100, default 20)`,
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
        const params: Record<string, unknown> = { fields: POST_FIELDS, limit };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<MetaPost>>(
          `/${page_id}/tagged`,
          pageToken,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No tagged posts found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Tagged Posts (${data.data.length})`, ""];
        for (const post of data.data) {
          lines.push(`## \`${post.id}\``);
          lines.push(`- **From**: ${post.from?.name ?? "Unknown"}`);
          lines.push(`- **Created**: ${formatDate(post.created_time)}`);
          if (post.message) lines.push(`- **Message**: ${truncateField(post.message, 200)}`);
          if (post.permalink_url) lines.push(`- **Link**: ${post.permalink_url}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "tagged posts") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Page Fans / Followers ─────────────────────────────────────────
  server.registerTool(
    "meta_get_page_fan_demographics",
    {
      title: "Get Page Fan Demographics",
      description: `Reports retirement of legacy Page fan demographic metrics. Meta retired all four accepted selectors. City/country alternatives are page_follows_city/page_follows_country; age/gender and locale have no documented replacement. No Graph API request is sent. Consult current Page Insights documentation for supported replacement metrics and periods.`,
      inputSchema: z
        .object({
          page_id: z.string(),
          metric: z
            .enum(["page_fans_city", "page_fans_country", "page_fans_gender_age", "page_fans_locale"])
            .default("page_fans_gender_age"),
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
    async ({ metric }) => ({
      content: [{ type: "text", text: `The ${metric} metric is retired. See https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics/ for replacements. No request was sent; verify a replacement's period before using meta_get_page_insights.` }],
      isError: true,
    })
  );

  // ─── Get Post Reactions ────────────────────────────────────────────────
  server.registerTool(
    "meta_get_post_reactions",
    {
      title: "Get Post Reactions",
      description: `Gets reaction counts (like, love, haha, wow, sad, angry) on a post.

Args:
  - post_id (string): Post ID`,
      inputSchema: z
        .object({
          post_id: z.string(),
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
    async ({ post_id, response_format }) => {
      try {
        const reactionTypes = ["LIKE", "LOVE", "HAHA", "WOW", "SAD", "ANGRY"];
        const results = await Promise.all(
          reactionTypes.map((type) =>
            client.get<{ summary: { total_count: number } }>(
              `/${post_id}/reactions`,
              { type, summary: "total_count", limit: 0 }
            )
          )
        );
        const counts: Record<string, number> = {};
        reactionTypes.forEach((type, i) => {
          counts[type] = results[i].summary?.total_count ?? 0;
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(counts, null, 2) }] };
        }

        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const lines = [`# Reactions on \`${post_id}\` (${formatNumber(total)} total)`, ""];
        const emojis: Record<string, string> = { LIKE: "👍", LOVE: "❤️", HAHA: "😂", WOW: "😮", SAD: "😢", ANGRY: "😡" };
        for (const [type, count] of Object.entries(counts)) {
          if (count > 0) lines.push(`- ${emojis[type] ?? ""} **${type}**: ${formatNumber(count)}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Share Post ────────────────────────────────────────────────────────
  server.registerTool(
    "meta_update_post",
    {
      title: "Update Facebook Post",
      description: `Updates an existing Facebook Page post's message text and/or pinned state.

Args:
  - post_id (string): Post ID
  - page_id (string): Page ID (for token)
  - message (string, optional): New message text
  - is_pinned (boolean, optional): Pin (true) or unpin (false) the post at the top of the Page`,
      inputSchema: z
        .object({
          post_id: z.string(),
          page_id: z.string(),
          message: z.string().min(1).optional(),
          is_pinned: z.boolean().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ post_id, page_id, message, is_pinned, response_format }) => {
      try {
        if (message === undefined && is_pinned === undefined) {
          return {
            content: [
              {
                type: "text",
                text: "Nothing to update: provide at least one of `message` or `is_pinned`.",
              },
            ],
          };
        }

        const pageToken = client.requirePageToken(page_id);
        const params: Record<string, string | boolean> = {};
        if (message !== undefined) params.message = message;
        if (is_pinned !== undefined) params.is_pinned = is_pinned;

        const result = await client.post<{ success: boolean }>(
          `/${post_id}`,
          params,
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{ type: "text", text: `Post \`${post_id}\` updated.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Page Videos ───────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_videos",
    {
      title: "Get Page Videos",
      description: `Lists videos uploaded to a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max results (1–100, default 20)`,
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
          fields: "id,title,description,length,views,created_time,permalink_url,source",
          limit,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string;
          title?: string;
          description?: string;
          length?: number;
          views?: number;
          created_time?: string;
          permalink_url?: string;
        }>>(`/${page_id}/videos`, pageToken, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No videos found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Page Videos (${data.data.length})`, ""];
        for (const video of data.data) {
          lines.push(`## ${video.title ?? "Untitled"} (\`${video.id}\`)`);
          if (video.length) lines.push(`- **Duration**: ${Math.round(video.length)}s`);
          if (video.views !== undefined) lines.push(`- **Views**: ${formatNumber(video.views)}`);
          if (video.created_time) lines.push(`- **Created**: ${formatDate(video.created_time)}`);
          if (video.permalink_url) lines.push(`- **Link**: ${video.permalink_url}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "videos") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Visitor Posts ─────────────────────────────────────────────────
  server.registerTool(
    "meta_get_visitor_posts",
    {
      title: "Get Visitor Posts",
      description: `Gets posts published by visitors on the Facebook Page wall.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max results (1–100, default 20)`,
      inputSchema: z
        .object({
          page_id: z.string(),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ page_id, limit, after, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const params: Record<string, unknown> = { fields: POST_FIELDS, limit };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<MetaPost>>(
          `/${page_id}/visitor_posts`,
          pageToken,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No visitor posts found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Visitor Posts (${data.data.length})`, ""];
        for (const post of data.data) {
          lines.push(`## \`${post.id}\``);
          lines.push(`- **From**: ${post.from?.name ?? "Unknown"}`);
          lines.push(`- **Created**: ${formatDate(post.created_time)}`);
          if (post.message) lines.push(`- **Message**: ${truncateField(post.message, 200)}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "visitor posts") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Published Posts ───────────────────────────────────────────────
  server.registerTool(
    "meta_get_published_posts",
    {
      title: "Get Published Posts",
      description: `Gets posts published by the Page itself (excludes visitor posts, unlike the feed edge).

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max results (1–100, default 20)`,
      inputSchema: z
        .object({
          page_id: z.string(),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ page_id, limit, after, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const params: Record<string, unknown> = { fields: POST_FIELDS, limit };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<MetaPost>>(
          `/${page_id}/published_posts`,
          pageToken,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No published posts found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Published Posts (${data.data.length})`, ""];
        for (const post of data.data) {
          lines.push(`## \`${post.id}\``);
          lines.push(`- **Created**: ${formatDate(post.created_time)}`);
          if (post.message) lines.push(`- **Message**: ${truncateField(post.message, 200)}`);
          if (post.permalink_url) lines.push(`- **Link**: ${post.permalink_url}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "published posts") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
