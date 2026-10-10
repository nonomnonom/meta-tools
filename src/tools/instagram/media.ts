import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatNumber, formatDate, ResponseFormatSchema } from "../../services/utils.js";
import { IG_MEDIA_FIELDS } from "../../constants.js";
import { InstagramMedia, MetaPaginatedResponse } from "../../types.js";

export function registerInstagramMediaTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Media Children (Carousel Items) ───────────────────────────────
  server.registerTool(
    "meta_get_instagram_media_children",
    {
      title: "Get Instagram Carousel Items",
      description: `Gets individual media items in a carousel/album post.

Args:
  - media_id (string): Carousel media ID`,
      inputSchema: z
        .object({
          media_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ media_id, response_format }) => {
      try {
        const data = await client.get<{ data: InstagramMedia[] }>(
          `/${media_id}/children`,
          { fields: "id,media_type,media_url,thumbnail_url,timestamp" }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No children found (not a carousel?)." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Carousel Items for \`${media_id}\` (${data.data.length})`, ""];
        for (const child of data.data) {
          lines.push(`## ${child.media_type} \`${child.id}\``);
          if (child.media_url) lines.push(`- **URL**: ${child.media_url}`);
          if (child.timestamp) lines.push(`- **Created**: ${formatDate(child.timestamp)}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Check Container Status ────────────────────────────────────────────
  server.registerTool(
    "meta_check_instagram_container",
    {
      title: "Check Instagram Container Status",
      description: `Checks the publishing status of an Instagram media container (used for reels/videos that need processing).

Args:
  - container_id (string): Container ID from a publish step

Returns: status_code — IN_PROGRESS, FINISHED, ERROR, EXPIRED.`,
      inputSchema: z
        .object({
          container_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ container_id, response_format }) => {
      try {
        const data = await client.get<{ id: string; status_code: string; status?: string }>(`/${container_id}`, {
          fields: "id,status_code,status",
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const code = data.status_code ?? "UNKNOWN";
        const lines = [`Container \`${container_id}\`: **${code}**`];
        if (code === "ERROR" && data.status) {
          lines.push(`\nError details: ${data.status}`);
        }
        if (code === "FINISHED") {
          lines.push(`\nReady to publish with \`meta_publish_instagram_container\`.`);
        }
        if (code === "IN_PROGRESS") {
          lines.push(`\nStill processing. Check again in a few seconds.`);
        }
        return { content: [{ type: "text", text: lines.join("") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Mentioned Media ───────────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_mentioned_media",
    {
      title: "Get Instagram Mentions",
      description: `Gets media where the Instagram account was @mentioned in a caption or comment.

Args:
  - ig_account_id (string): Instagram account ID
  - limit (number): Max results (default 20)

Requires instagram_manage_comments permission.`,
      inputSchema: z
        .object({
          ig_account_id: z.string(),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ig_account_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: IG_MEDIA_FIELDS,
          limit,
        };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<InstagramMedia>>(
          `/${ig_account_id}/tags`,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No mentioned media found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Mentioned Media (${data.data.length})`, ""];
        for (const media of data.data) {
          lines.push(`## ${media.media_type} \`${media.id}\``);
          if (media.caption) lines.push(`> ${truncateField(media.caption, 150)}`);
          if (media.permalink) lines.push(`- ${media.permalink}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "mentions") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Recently Searched Hashtags ────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_recent_hashtags",
    {
      title: "Get Recently Searched Hashtags",
      description: `Gets hashtags recently searched by the Instagram account.

Args:
  - ig_account_id (string): Instagram account ID

Note: Limited to 30 unique hashtag searches per 7 days. This returns the recent searches.`,
      inputSchema: z
        .object({
          ig_account_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ig_account_id, response_format }) => {
      try {
        const data = await client.get<{ data: Array<{ id: string; name: string }> }>(
          `/${ig_account_id}/recently_searched_hashtags`,
          {}
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No recently searched hashtags." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Recently Searched Hashtags`, ""];
        for (const h of data.data) {
          lines.push(`- #${h.name} (\`${h.id}\`)`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Instagram Live Media ──────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_live_media",
    {
      title: "Get Instagram Live Media",
      description: `Gets live video broadcasts from an Instagram account.

Args:
  - ig_account_id (string): Instagram account ID`,
      inputSchema: z
        .object({
          ig_account_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ig_account_id, response_format }) => {
      try {
        const data = await client.get<MetaPaginatedResponse<InstagramMedia>>(
          `/${ig_account_id}/live_media`,
          { fields: IG_MEDIA_FIELDS }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No live media found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Live Media (${data.data.length})`, ""];
        for (const media of data.data) {
          lines.push(`## \`${media.id}\``);
          if (media.timestamp) lines.push(`- **Time**: ${formatDate(media.timestamp)}`);
          if (media.permalink) lines.push(`- **Link**: ${media.permalink}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Product Tags ──────────────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_product_tags",
    {
      title: "Get Instagram Product Tags",
      description: `Gets product tags on an Instagram media object. Requires Instagram Shopping.

Args:
  - media_id (string): Instagram media ID`,
      inputSchema: z
        .object({
          media_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ media_id, response_format }) => {
      try {
        const data = await client.get<{ data: Array<{ product_id: string; merchant_id?: string; name?: string; image_url?: string; review_status?: string }> }>(
          `/${media_id}/product_tags`,
          {}
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No product tags on this media." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Product Tags on \`${media_id}\``, ""];
        for (const tag of data.data) {
          lines.push(`- **${tag.name ?? "Unknown"}** (\`${tag.product_id}\`)${tag.review_status ? ` — ${tag.review_status}` : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Pre-created Container ─────────────────────────────────────
  server.registerTool(
    "meta_publish_instagram_container",
    {
      title: "Publish Instagram Container",
      description: `Publishes a pre-created Instagram media container. Use after checking container status is FINISHED.

Useful for reels/videos where container creation and publishing are done in separate steps.

Args:
  - ig_account_id (string): Instagram account ID
  - container_id (string): Container ID (from a previous create step)`,
      inputSchema: z
        .object({
          ig_account_id: z.string(),
          container_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ig_account_id, container_id, response_format }) => {
      try {
        const result = await client.post<{ id: string }>(`/${ig_account_id}/media_publish`, {
          creation_id: container_id,
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Published.\n\n- **Media ID**: \`${result.id}\`` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Single Instagram Media ────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_single_media",
    {
      title: "Get Single Instagram Media Details",
      description: `Gets detailed information about a specific Instagram media object.

Args:
  - media_id (string): Instagram media ID`,
      inputSchema: z
        .object({
          media_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ media_id, response_format }) => {
      try {
        const data = await client.get<InstagramMedia>(`/${media_id}`, {
          fields: IG_MEDIA_FIELDS,
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `# Instagram Media \`${data.id}\``,
          "",
          `- **Type**: ${data.media_product_type ?? data.media_type}`,
          data.caption ? `- **Caption**: ${data.caption}` : "",
          data.timestamp ? `- **Posted**: ${formatDate(data.timestamp)}` : "",
          data.like_count !== undefined ? `- **Likes**: ${formatNumber(data.like_count)}` : "",
          data.comments_count !== undefined ? `- **Comments**: ${formatNumber(data.comments_count)}` : "",
          data.permalink ? `- **Link**: ${data.permalink}` : "",
          data.media_url ? `- **Media URL**: ${data.media_url}` : "",
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
