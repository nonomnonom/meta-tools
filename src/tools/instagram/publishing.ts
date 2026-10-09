import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatNumber, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { IG_ACCOUNT_FIELDS, IG_MEDIA_FIELDS } from "../../constants.js";
import { InstagramAccount, InstagramMedia, MetaPaginatedResponse } from "../../types.js";

export function registerInstagramPublishingTools(server: McpServer, client: MetaApiClient): void {
  // ─── List Instagram Accounts ──────────────────────────────────────────────
  server.registerTool(
    "meta_list_instagram_accounts",
    {
      title: "List Instagram Business Accounts",
      description: `Lists all Instagram professional accounts linked to the user's Facebook Pages.

Requires: meta_list_pages must be called first.

Returns: Instagram account IDs, usernames, follower counts. The account ID is needed for all other Instagram tools.`,
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
        // Use nested field expansion to fetch IG details in a single API call (avoids N+1)
        const pagesData = await client.get<{
          data: Array<{
            id: string;
            name: string;
            access_token?: string;
            instagram_business_account?: InstagramAccount;
          }>;
        }>("/me/accounts", {
          fields: `id,name,access_token,instagram_business_account{${IG_ACCOUNT_FIELDS}}`,
        });

        const accounts: Array<InstagramAccount & { page_name: string; page_id: string }> = [];

        for (const page of pagesData.data) {
          if (page.access_token) client.cachePageToken(page.id, page.access_token);
          if (!page.instagram_business_account?.id) continue;
          accounts.push({ ...page.instagram_business_account, page_name: page.name, page_id: page.id });
        }

        if (!accounts.length) {
          return {
            content: [
              {
                type: "text",
                text: "No Instagram business accounts found linked to your Facebook Pages.",
              },
            ],
          };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }] };
        }

        const lines = [`# Instagram Business Accounts (${accounts.length})`, ""];
        for (const acc of accounts) {
          lines.push(`## @${acc.username ?? acc.name ?? "Unknown"} (\`${acc.id}\`)`);
          lines.push(`- **Page**: ${acc.page_name} (\`${acc.page_id}\`)`);
          lines.push(`- **Followers**: ${formatNumber(acc.followers_count)}`);
          lines.push(`- **Following**: ${formatNumber(acc.follows_count)}`);
          lines.push(`- **Posts**: ${formatNumber(acc.media_count)}`);
          if (acc.biography) lines.push(`- **Bio**: ${acc.biography}`);
          if (acc.website) lines.push(`- **Website**: ${acc.website}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Instagram Media ──────────────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_media",
    {
      title: "Get Instagram Media",
      description: `Lists media (posts, reels, stories) from an Instagram professional account.

Args:
  - ig_account_id (string): Instagram account ID (from meta_list_instagram_accounts)
  - limit (number): Max items to return (1–100, default 20)
  - after (string, optional): Pagination cursor`,
      inputSchema: z
        .object({
          ig_account_id: z.string().describe("Instagram account ID"),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional().describe("Pagination cursor"),
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
    async ({ ig_account_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = { fields: IG_MEDIA_FIELDS, limit };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<InstagramMedia>>(
          `/${ig_account_id}/media`,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No media found for this Instagram account." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Instagram Media (${data.data.length} shown)`, ""];
        for (const media of data.data) {
          const type = media.media_product_type ?? media.media_type;
          lines.push(`## ${type} \`${media.id}\``);
          lines.push(`- **Posted**: ${formatDate(media.timestamp)}`);
          if (media.caption) lines.push(`- **Caption**: ${truncateField(media.caption, 150)}`);
          lines.push(`- **Likes**: ${formatNumber(media.like_count)} | **Comments**: ${formatNumber(media.comments_count)}`);
          if (media.permalink) lines.push(`- **Link**: ${media.permalink}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "media") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Instagram Photo ──────────────────────────────────────────────
  server.registerTool(
    "meta_publish_instagram_photo",
    {
      title: "Publish Instagram Photo",
      description: `Publishes a single image post to an Instagram professional account.

Two-step process: creates a media container then publishes it.

Args:
  - ig_account_id (string): Instagram account ID
  - image_url (string): Public URL of the JPEG image to post (must be publicly accessible)
  - caption (string, optional): Post caption (supports hashtags and @mentions)
  - alt_text (string, optional): Alt text for accessibility (screen readers)
  - location_id (string, optional): Facebook Place ID to tag location

Returns: Media ID of the published post.

Scheduling: Pass scheduled_publish_time (Unix timestamp, 10 min – 75 days in future) to schedule the post instead of publishing immediately.

Limitations:
  - JPEG only (no PNG, GIF, HEIC)
  - Max 100 posts per 24 hours
  - Image must be hosted on a public server`,
      inputSchema: z
        .object({
          ig_account_id: z.string().describe("Instagram account ID"),
          image_url: z.string().url().describe("Public URL of the JPEG image"),
          caption: z.string().optional().describe("Post caption"),
          alt_text: z.string().optional().describe("Alt text for accessibility"),
          location_id: z.string().optional().describe("Facebook Place ID"),
          scheduled_publish_time: z.number().int().optional().describe("Unix timestamp to schedule post (10 min – 75 days in future)"),
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
    async ({ ig_account_id, image_url, caption, alt_text, location_id, scheduled_publish_time, response_format }) => {
      try {
        // Step 1: Create container
        const containerFields: Record<string, unknown> = { image_url };
        if (caption) containerFields.caption = caption;
        if (alt_text) containerFields.alt_text = alt_text;
        if (location_id) containerFields.location_id = location_id;

        const container = await client.post<{ id: string }>(
          `/${ig_account_id}/media`,
          containerFields
        );

        // Step 2: Publish
        const publishFields: Record<string, unknown> = { creation_id: container.id };
        if (scheduled_publish_time) {
          publishFields.published = false;
          publishFields.scheduled_publish_time = scheduled_publish_time;
        }
        const result = await client.post<{ id: string }>(`/${ig_account_id}/media_publish`, publishFields);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        const action = scheduled_publish_time ? "scheduled" : "published";
        return {
          content: [
            {
              type: "text",
              text: [
                `Photo ${action} on Instagram successfully.`,
                "",
                `- **Media ID**: \`${result.id}\``,
                `- **Container ID**: \`${container.id}\``,
                ...(scheduled_publish_time ? [`- **Scheduled for**: ${new Date(scheduled_publish_time * 1000).toISOString()}`] : []),
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Instagram Reel ───────────────────────────────────────────────
  server.registerTool(
    "meta_publish_instagram_reel",
    {
      title: "Publish Instagram Reel",
      description: `Publishes a video reel to an Instagram professional account.

Args:
  - ig_account_id (string): Instagram account ID
  - video_url (string): Public URL of the video file (MP4 recommended)
  - caption (string, optional): Reel caption
  - share_to_feed (boolean, optional): Also share to feed. Default true.

Returns: Media ID of the published reel.

Notes:
  - Video must be on a publicly accessible server
  - Check container status before publishing — video processing can take time
  - Use meta_check_instagram_container to check readiness
  - Scheduling: Pass scheduled_publish_time (Unix timestamp, 10 min – 75 days in future) to schedule instead of publishing immediately`,
      inputSchema: z
        .object({
          ig_account_id: z.string(),
          video_url: z.string().url().describe("Public URL of the video"),
          caption: z.string().optional(),
          share_to_feed: z.boolean().default(true),
          scheduled_publish_time: z.number().int().optional().describe("Unix timestamp to schedule reel (10 min – 75 days in future)"),
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
    async ({ ig_account_id, video_url, caption, share_to_feed, scheduled_publish_time, response_format }) => {
      try {
        const containerFields: Record<string, unknown> = {
          media_type: "REELS",
          video_url,
          share_to_feed,
        };
        if (caption) containerFields.caption = caption;

        const container = await client.post<{ id: string }>(
          `/${ig_account_id}/media`,
          containerFields
        );

        // Poll status (video needs processing time)
        const statusCode = await client.pollContainerStatus(container.id, "instagram");

        if (statusCode !== "FINISHED") {
          return {
            content: [
              {
                type: "text",
                text: [
                  `Container created (\`${container.id}\`) but video processing status: ${statusCode}.`,
                  "",
                  "If status is FINISHED, publish with:",
                  `\`meta_publish_instagram_container\` with container_id: \`${container.id}\``,
                ].join("\n"),
              },
            ],
          };
        }

        const publishFields: Record<string, unknown> = { creation_id: container.id };
        if (scheduled_publish_time) {
          publishFields.published = false;
          publishFields.scheduled_publish_time = scheduled_publish_time;
        }
        const result = await client.post<{ id: string }>(`/${ig_account_id}/media_publish`, publishFields);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        const action = scheduled_publish_time ? "scheduled" : "published";
        return {
          content: [
            {
              type: "text",
              text: [
                `Reel ${action} successfully.`,
                "",
                `- **Media ID**: \`${result.id}\``,
                ...(scheduled_publish_time ? [`- **Scheduled for**: ${new Date(scheduled_publish_time * 1000).toISOString()}`] : []),
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Instagram Story ──────────────────────────────────────────────
  server.registerTool(
    "meta_publish_instagram_story",
    {
      title: "Publish Instagram Story",
      description: `Publishes an image or video story to an Instagram professional account.

Args:
  - ig_account_id (string): Instagram account ID
  - media_url (string): Public URL of the image or video
  - media_type (string): 'IMAGE' or 'VIDEO'

Returns: Media ID of the published story.`,
      inputSchema: z
        .object({
          ig_account_id: z.string(),
          media_url: z.string().url().describe("Public URL of image or video"),
          media_type: z.enum(["IMAGE", "VIDEO"]).describe("Type of story media"),
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
    async ({ ig_account_id, media_url, media_type, response_format }) => {
      try {
        const containerFields: Record<string, unknown> = {
          media_type: "STORIES",
          ...(media_type === "IMAGE" ? { image_url: media_url } : { video_url: media_url }),
        };

        const container = await client.post<{ id: string }>(
          `/${ig_account_id}/media`,
          containerFields
        );

        // Video stories need processing time
        if (media_type === "VIDEO") {
          const statusCode = await client.pollContainerStatus(container.id, "instagram");
          if (statusCode !== "FINISHED") {
            return {
              content: [{
                type: "text",
                text: `Container created (\`${container.id}\`) but video processing status: ${statusCode}.\n\nUse \`meta_publish_instagram_container\` to publish when ready.`,
              }],
            };
          }
        }

        const result = await client.post<{ id: string }>(`/${ig_account_id}/media_publish`, {
          creation_id: container.id,
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `Story published successfully.\n\n- **Media ID**: \`${result.id}\``,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Instagram Carousel ───────────────────────────────────────────
  server.registerTool(
    "meta_publish_instagram_carousel",
    {
      title: "Publish Instagram Carousel Post",
      description: `Publishes a carousel post (2–10 images/videos) to Instagram.

Three-step process:
1. Creates individual media containers for each item
2. Creates a carousel container referencing them
3. Publishes the carousel

Args:
  - ig_account_id (string): Instagram account ID
  - items (array): Array of up to 10 items, each with:
      - url (string): Public image URL (JPEG) or video URL
      - type (string): 'IMAGE' or 'VIDEO'
  - caption (string, optional): Carousel caption

Returns: Media ID of the published carousel.

Scheduling: Pass scheduled_publish_time (Unix timestamp, 10 min – 75 days in future) to schedule instead of publishing immediately.`,
      inputSchema: z
        .object({
          ig_account_id: z.string(),
          items: z
            .array(
              z.object({
                url: z.string().url(),
                type: z.enum(["IMAGE", "VIDEO"]),
              })
            )
            .min(2)
            .max(10)
            .describe("Media items for carousel (2–10)"),
          caption: z.string().optional(),
          scheduled_publish_time: z.number().int().optional().describe("Unix timestamp to schedule carousel (10 min – 75 days in future)"),
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
    async ({ ig_account_id, items, caption, scheduled_publish_time, response_format }) => {
      try {
        // Step 1: Create all item containers in parallel
        const results = await Promise.allSettled(
          items.map(async (item) => {
            const fields: Record<string, unknown> = {
              is_carousel_item: "true",
              ...(item.type === "IMAGE" ? { image_url: item.url } : { video_url: item.url, media_type: "VIDEO" }),
            };
            return { ...(await client.post<{ id: string }>(`/${ig_account_id}/media`, fields)), type: item.type as string };
          })
        );
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        if (rejected.length) {
          const created = results
            .filter((r): r is PromiseFulfilledResult<{ id: string; type: string }> => r.status === "fulfilled")
            .map((r) => r.value.id);
          return {
            content: [{
              type: "text",
              text: `Failed to create ${rejected.length} carousel item container(s). ` +
                (created.length ? `Already created: ${created.map((id) => `\`${id}\``).join(", ")}. ` : "") +
                `Errors: ${rejected.map((r) => (r.reason as Error)?.message ?? String(r.reason)).join("; ")}`,
            }],
            isError: true,
          };
        }
        const containers = (results as PromiseFulfilledResult<{ id: string; type: string }>[]).map((r) => r.value);

        // Step 1b: Poll all video containers in parallel
        const videoContainers = containers.filter((c) => c.type === "VIDEO");
        if (videoContainers.length) {
          const statuses = await Promise.all(
            videoContainers.map((c) => client.pollContainerStatus(c.id, "instagram"))
          );
          const failed = videoContainers
            .map((c, i) => ({ ...c, status: statuses[i] }))
            .filter((c) => c.status !== "FINISHED");
          if (failed.length) {
            return {
              content: [{
                type: "text",
                text: `Video container(s) ${failed.map((c) => `\`${c.id}\` (${c.status})`).join(", ")} did not finish processing. Cannot assemble carousel until all videos are FINISHED.`,
              }],
            };
          }
        }
        const containerIds = containers.map((c) => c.id);

        // Step 2: Create carousel container
        const carouselFields: Record<string, unknown> = {
          media_type: "CAROUSEL",
          children: containerIds.join(","),
        };
        if (caption) carouselFields.caption = caption;

        const carousel = await client.post<{ id: string }>(
          `/${ig_account_id}/media`,
          carouselFields
        );

        // Step 3: Publish
        const publishFields: Record<string, unknown> = { creation_id: carousel.id };
        if (scheduled_publish_time) {
          publishFields.published = false;
          publishFields.scheduled_publish_time = scheduled_publish_time;
        }
        const result = await client.post<{ id: string }>(`/${ig_account_id}/media_publish`, publishFields);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        const action = scheduled_publish_time ? "scheduled" : "published";
        return {
          content: [
            {
              type: "text",
              text: [
                `Carousel ${action} successfully (${items.length} items).`,
                "",
                `- **Media ID**: \`${result.id}\``,
                `- **Item containers**: ${containerIds.map((id) => `\`${id}\``).join(", ")}`,
                ...(scheduled_publish_time ? [`- **Scheduled for**: ${new Date(scheduled_publish_time * 1000).toISOString()}`] : []),
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Check Instagram Publishing Limit ────────────────────────────────────
  server.registerTool(
    "meta_check_instagram_publishing_limit",
    {
      title: "Check Instagram Publishing Rate Limit",
      description: `Checks how many of the 100 API-published posts per 24-hour limit have been used.

Args:
  - ig_account_id (string): Instagram account ID

Returns: Current usage and quota remaining.`,
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
        const data = await client.get<{ data: Array<{ quota_usage: number; config: { quota_total: number; quota_duration: number } }> }>(
          `/${ig_account_id}/content_publishing_limit`,
          { fields: "quota_usage,config" }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const limit = data.data?.[0];
        if (!limit) {
          return { content: [{ type: "text", text: "No publishing limit data available." }] };
        }

        const remaining = (limit.config?.quota_total ?? 100) - limit.quota_usage;
        return {
          content: [{
            type: "text",
            text: `# Instagram Publishing Limit\n\n- **Used**: ${limit.quota_usage} / ${limit.config?.quota_total ?? 100}\n- **Remaining**: ${remaining}\n- **Window**: ${Math.round((limit.config?.quota_duration ?? 86400) / 3600)} hours`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
