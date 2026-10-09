import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatNumber, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { POST_FIELDS } from "../../constants.js";
import { MetaPost, MetaPaginatedResponse } from "../../types.js";

export function registerPageSettingsTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Page Tabs ─────────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_tabs",
    {
      title: "Get Page Tabs",
      description: `Lists custom tabs on a Facebook Page.

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
        const data = await client.getWithToken<{ data: Array<{
          id: string;
          name: string;
          link?: string;
          position?: number;
          is_permanent?: boolean;
          application?: { id: string; name: string };
        }> }>(`/${page_id}/tabs`, pageToken, {});

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No tabs found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Page Tabs (${data.data.length})`, ""];
        for (const tab of data.data) {
          lines.push(`- **${tab.name}** (\`${tab.id}\`)${tab.position !== undefined ? ` — Position: ${tab.position}` : ""}${tab.is_permanent ? " [permanent]" : ""}${tab.application ? ` | App: ${tab.application.name}` : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Page Picture ──────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_picture",
    {
      title: "Get Page Profile Picture",
      description: `Gets the profile picture URL for a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - size (string): Picture size — small, normal, large, square (default: large)`,
      inputSchema: z
        .object({
          page_id: z.string(),
          size: z.enum(["small", "normal", "large", "square"]).default("large"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ page_id, size, response_format }) => {
      try {
        const data = await client.get<{ data: { url: string; width?: number; height?: number; is_silhouette?: boolean } }>(
          `/${page_id}/picture`,
          { type: size, redirect: "false" }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `**Page Picture** (${size})\n\n- **URL**: ${data.data.url}${data.data.width ? `\n- **Size**: ${data.data.width}x${data.data.height}` : ""}${data.data.is_silhouette ? "\n- _Default/silhouette image_" : ""}`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Single Post ───────────────────────────────────────────────────
  server.registerTool(
    "meta_get_post",
    {
      title: "Get Single Post Details",
      description: `Gets detailed information about a specific Facebook post.

Args:
  - post_id (string): Post ID (format: {page_id}_{post_id})`,
      inputSchema: z
        .object({
          post_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ post_id, response_format }) => {
      try {
        const data = await client.get<MetaPost & {
          shares?: { count: number };
          likes?: { summary: { total_count: number } };
          comments?: { summary: { total_count: number } };
        }>(`/${post_id}`, {
          fields: POST_FIELDS + ",shares,likes.summary(true),comments.summary(true)",
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `# Post \`${data.id}\``,
          "",
          `- **Created**: ${formatDate(data.created_time)}`,
          data.from ? `- **From**: ${data.from.name}` : "",
          data.message ? `- **Message**: ${data.message}` : "",
          data.story ? `- **Story**: ${data.story}` : "",
          data.permalink_url ? `- **Link**: ${data.permalink_url}` : "",
          data.shares ? `- **Shares**: ${formatNumber(data.shares.count)}` : "",
          data.likes?.summary ? `- **Likes**: ${formatNumber(data.likes.summary.total_count)}` : "",
          data.comments?.summary ? `- **Comments**: ${formatNumber(data.comments.summary.total_count)}` : "",
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Event ──────────────────────────────────────────────────────
  server.registerTool(
    "meta_create_event",
    {
      title: "Create Facebook Page Event",
      description: `Creates an event on a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - name (string): Event name
  - start_time (string): ISO 8601 datetime (e.g., 2024-06-15T18:00:00-0400)
  - end_time (string, optional): ISO 8601 datetime
  - description (string, optional): Event description
  - place (string, optional): Location name
  - ticket_uri (string, optional): Ticket URL`,
      inputSchema: z
        .object({
          page_id: z.string(),
          name: z.string().min(1),
          start_time: z.string().describe("ISO 8601 datetime"),
          end_time: z.string().optional(),
          description: z.string().optional(),
          place: z.string().optional(),
          ticket_uri: z.string().url().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ page_id, name, start_time, end_time, description, place, ticket_uri, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const fields: Record<string, unknown> = { name, start_time };
        if (end_time) fields.end_time = end_time;
        if (description) fields.description = description;
        if (place) fields.place = place;
        if (ticket_uri) fields.ticket_uri = ticket_uri;

        const result = await client.post<{ id: string }>(`/${page_id}/events`, fields, pageToken);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Event created.\n\n- **Event ID**: \`${result.id}\`\n- **Name**: ${name}` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Page Locations ────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_locations",
    {
      title: "Get Page Locations",
      description: `Lists location pages for a business with multiple locations.

Args:
  - page_id (string): Parent Facebook Page ID`,
      inputSchema: z
        .object({
          page_id: z.string(),
          limit: z.number().int().min(1).max(100).default(20),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ page_id, limit, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string; name: string; location?: { city?: string; state?: string; country?: string; street?: string; zip?: string; latitude?: number; longitude?: number };
        }>>(`/${page_id}/locations`, pageToken, {
          fields: "id,name,location",
          limit,
        });

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No locations found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Page Locations (${data.data.length})`, ""];
        for (const loc of data.data) {
          const addr = loc.location;
          lines.push(`- **${loc.name}** (\`${loc.id}\`)${addr ? ` — ${[addr.street, addr.city, addr.state, addr.country].filter(Boolean).join(", ")}` : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get/Set Page CTA ──────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_cta",
    {
      title: "Get Page Call-to-Action",
      description: `Gets the call-to-action button configured on a Facebook Page.

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
        const data = await client.getWithToken<{ data: Array<{ id: string; type: string; web_url?: string; status?: string }> }>(
          `/${page_id}/call_to_actions`,
          pageToken,
          { fields: "id,type,web_url,status" }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No CTA configured." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const cta = data.data[0];
        return {
          content: [{
            type: "text",
            text: `# Page CTA\n\n- **Type**: ${cta.type}\n- **ID**: \`${cta.id}\`${cta.web_url ? `\n- **URL**: ${cta.web_url}` : ""}${cta.status ? `\n- **Status**: ${cta.status}` : ""}`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Page Photos ───────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_photos",
    {
      title: "Get Page Photos",
      description: `Lists photos uploaded to a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - type (string): 'uploaded' (by page) or 'tagged' (photos page is tagged in)
  - limit (number): Max results (default 20)`,
      inputSchema: z
        .object({
          page_id: z.string(),
          type: z.enum(["uploaded", "tagged"]).default("uploaded"),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ page_id, type, limit, after, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const params: Record<string, unknown> = {
          fields: "id,name,picture,source,created_time,link,album",
          limit,
          type,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string; name?: string; picture?: string; source?: string; created_time?: string; link?: string;
        }>>(`/${page_id}/photos`, pageToken, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No photos found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Page Photos — ${type} (${data.data.length})`, ""];
        for (const photo of data.data) {
          lines.push(`- \`${photo.id}\`${photo.name ? ` — ${truncateField(photo.name, 80)}` : ""}${photo.created_time ? ` | ${formatDate(photo.created_time)}` : ""}`);
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "photos") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Page Ratings ──────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_ratings",
    {
      title: "Get Page Ratings/Reviews",
      description: `Gets ratings and reviews for a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max results (default 20)`,
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
        const params: Record<string, unknown> = {
          fields: "reviewer,rating,review_text,created_time,recommendation_type",
          limit,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<{
          reviewer?: { name: string; id: string };
          rating?: number;
          review_text?: string;
          created_time?: string;
          recommendation_type?: string;
        }>>(`/${page_id}/ratings`, pageToken, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No ratings/reviews found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Page Ratings (${data.data.length})`, ""];
        for (const r of data.data) {
          const stars = r.rating ? `${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}` : r.recommendation_type ?? "";
          lines.push(`**${r.reviewer?.name ?? "Anonymous"}** ${stars} (${formatDate(r.created_time)})`);
          if (r.review_text) lines.push(`> ${truncateField(r.review_text, 200)}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "ratings") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Subscribe Page to Webhooks ────────────────────────────────────────
  server.registerTool(
    "meta_subscribe_page_webhooks",
    {
      title: "Subscribe Page to Webhooks",
      description: `Subscribes your app to receive webhook updates for a Facebook Page.

Args:
  - page_id (string): Facebook Page ID
  - subscribed_fields (string[]): Fields to subscribe to, e.g., feed, messages, messaging_postbacks, conversations

Call without subscribed_fields to check current subscriptions.`,
      inputSchema: z
        .object({
          page_id: z.string(),
          subscribed_fields: z.array(z.string()).optional().describe("Webhook fields to subscribe to"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ page_id, subscribed_fields, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);

        if (!subscribed_fields?.length) {
          // GET to check current subscriptions
          const data = await client.getWithToken<{ data: Array<{ name: string; id: string }> }>(
            `/${page_id}/subscribed_apps`,
            pageToken,
            {}
          );
          if (response_format === "json") {
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
          }
          if (!data.data?.length) {
            return { content: [{ type: "text", text: "No webhook subscriptions." }] };
          }
          const lines = [`# Current Webhook Subscriptions`, ""];
          for (const sub of data.data) {
            lines.push(`- **${sub.name}** (\`${sub.id}\`)`);
          }
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        const result = await client.post<{ success: boolean }>(
          `/${page_id}/subscribed_apps`,
          { subscribed_fields: subscribed_fields.join(",") },
          pageToken
        );

        return {
          content: [{ type: "text", text: result.success ? `Subscribed to: ${subscribed_fields.join(", ")}` : "Subscription failed." }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Promotable Posts ──────────────────────────────────────────────
  server.registerTool(
    "meta_get_promotable_posts",
    {
      title: "Get Promotable Posts",
      description: `Reads one Page feed page and returns posts explicitly eligible for promotion. Unknown eligibility is excluded. Limit applies before filtering; use the returned cursor to continue.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max results (default 20)`,
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
        const params: Record<string, unknown> = { fields: POST_FIELDS + ",is_eligible_for_promotion", limit };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<MetaPost & { is_eligible_for_promotion?: boolean }>>(
          `/${page_id}/feed`,
          pageToken,
          params
        );

        const eligible = { ...data, data: (data.data ?? []).filter((post) => post.is_eligible_for_promotion === true) };
        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(eligible, null, 2) }] };
        }
        const next = data.paging?.next ? data.paging.cursors?.after : undefined;
        if (!eligible.data.length) {
          return { content: [{ type: "text", text: "No explicitly eligible posts on this feed page." + buildPaginationNote(0, next) }] };
        }

        const lines = [`# Promotable Posts (${eligible.data.length})`, ""];
        for (const post of eligible.data) {
          lines.push(`- \`${post.id}\` — ${formatDate(post.created_time)}${post.message ? ` | ${truncateField(post.message, 80)}` : ""}`);
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n") + buildPaginationNote(eligible.data.length, next), "promotable posts") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Update Page Profile Picture ────────────────────────────────────────
  server.registerTool(
    "meta_update_page_picture",
    {
      title: "Update Facebook Page Profile Picture",
      description: `Updates a Facebook Page's profile picture.

Args:
  - page_id (string): Facebook Page ID
  - picture_url (string): URL of the new profile picture

Requires pages_manage_metadata permission.`,
      inputSchema: z
        .object({
          page_id: z.string(),
          picture_url: z.string().url().describe("URL of the new profile picture image"),
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
    async ({ page_id, picture_url, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const result = await client.post<{ success?: boolean; id?: string }>(
          `/${page_id}/picture`,
          { picture: picture_url },
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{ type: "text", text: `Profile picture updated for page \`${page_id}\`.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Update Page Cover Photo ────────────────────────────────────────────
  server.registerTool(
    "meta_update_page_cover",
    {
      title: "Update Facebook Page Cover Photo",
      description: `Updates a Facebook Page's cover photo.

Args:
  - page_id (string): Facebook Page ID
  - cover_url (string, optional): URL of the new cover photo
  - photo_id (string, optional): ID of an existing photo to use as cover
  - offset_y (number, optional): Vertical offset of the cover photo (0–100)
  - no_feed_story (boolean, optional): If true, don't publish a feed story about the change

Provide either cover_url or photo_id. Requires pages_manage_metadata permission.`,
      inputSchema: z
        .object({
          page_id: z.string(),
          cover_url: z.string().url().optional().describe("URL of the new cover photo"),
          photo_id: z.string().optional().describe("ID of existing photo to use as cover"),
          offset_y: z.number().min(0).max(100).optional().describe("Vertical offset (0–100)"),
          no_feed_story: z.boolean().optional().describe("Suppress feed story about the change"),
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
    async ({ page_id, cover_url, photo_id, offset_y, no_feed_story, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const fields: Record<string, unknown> = {};
        if (cover_url) fields.source = cover_url;
        if (photo_id) fields.photo = photo_id;
        if (offset_y !== undefined) fields.offset_y = offset_y;
        if (no_feed_story !== undefined) fields.no_feed_story = no_feed_story;

        if (!cover_url && !photo_id) {
          return { content: [{ type: "text", text: "Error: Provide either cover_url or photo_id." }], isError: true };
        }

        const result = await client.post<{ id?: string }>(`/${page_id}`, { cover: fields }, pageToken);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{ type: "text", text: `Cover photo updated for page \`${page_id}\`.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
