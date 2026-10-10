import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatNumber, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { MetaPaginatedResponse } from "../../types.js";

export function registerPageStoryTools(server: McpServer, client: MetaApiClient): void {
  // ─── Hide/Unhide Comment ────────────────────────────────────────────────
  server.registerTool(
    "meta_hide_comment",
    {
      title: "Hide or Unhide a Facebook Comment",
      description: `Hides or unhides a comment on a Facebook Page post.

Hidden comments are only visible to the comment author and their friends.
This is a non-destructive alternative to deletion — useful for moderation.

Args:
  - comment_id (string): Comment ID to hide/unhide
  - page_id (string): Page ID (for authentication)
  - is_hidden (boolean): true to hide, false to unhide

Requires pages_manage_engagement permission.`,
      inputSchema: z
        .object({
          comment_id: z.string(),
          page_id: z.string().describe("Page ID (for auth)"),
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
    async ({ comment_id, page_id, is_hidden }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        await client.post(`/${comment_id}`, { is_hidden }, pageToken);
        return {
          content: [{ type: "text", text: `Comment \`${comment_id}\` ${is_hidden ? "hidden" : "unhidden"} successfully.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Page Story ───────────────────────────────────────────────────
  server.registerTool(
    "meta_publish_page_story",
    {
      title: "Publish Facebook Page Story",
      description: `Publishes a story (photo or video) to a Facebook Page.

Requires: meta_list_pages called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID
  - media_url (string): Public URL of the image or video
  - media_type (enum): "photo" or "video"

Returns the story ID on success.`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          media_url: z.string().url().describe("Public URL of the image or video"),
          media_type: z.enum(["photo", "video"]).describe("Type of media: photo or video"),
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
    async ({ page_id, media_url, media_type, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const fields: Record<string, unknown> =
          media_type === "photo" ? { photo_url: media_url } : { video_url: media_url };

        const result = await client.post<{ id: string }>(
          `/${page_id}/stories`,
          fields,
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `Story published.\n\n- **Story ID**: \`${result.id}\``,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Live Video ────────────────────────────────────────────────────
  server.registerTool(
    "meta_create_live_video",
    {
      title: "Create Facebook Live Video",
      description: `Creates a live video broadcast on a Facebook Page.

Requires: meta_list_pages called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID
  - title (string): Title of the live video
  - description (string, optional): Description of the broadcast
  - planned_start_time (string, optional): ISO 8601 datetime for scheduled broadcasts

If planned_start_time is provided, the broadcast is created as SCHEDULED_UNPUBLISHED; otherwise it goes LIVE_NOW.

Returns the stream URL and live video ID.`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          title: z.string().describe("Title of the live video"),
          description: z.string().optional().describe("Description of the broadcast"),
          planned_start_time: z.string().optional().describe("ISO 8601 datetime for scheduled broadcasts"),
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
    async ({ page_id, title, description, planned_start_time, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const fields: Record<string, unknown> = {
          title,
          status: planned_start_time ? "SCHEDULED_UNPUBLISHED" : "LIVE_NOW",
        };
        if (description) fields.description = description;
        if (planned_start_time) fields.planned_start_time = planned_start_time;

        const result = await client.post<{ id: string; stream_url?: string }>(
          `/${page_id}/live_videos`,
          fields,
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        const lines = [
          "Live video created.",
          "",
          `- **Live Video ID**: \`${result.id}\``,
        ];
        if (result.stream_url) lines.push(`- **Stream URL**: ${result.stream_url}`);
        if (planned_start_time) lines.push(`- **Scheduled For**: ${planned_start_time}`);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Live Videos ──────────────────────────────────────────────────────
  server.registerTool(
    "meta_get_live_videos",
    {
      title: "List Facebook Live Videos",
      description: `Lists live videos on a Facebook Page.

Requires: meta_list_pages called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID
  - broadcast_status (enum, optional): Filter by status — "LIVE", "UNPUBLISHED", "SCHEDULED_UNPUBLISHED", or "VOD"
  - limit (number, optional): Max results (1–100, default 10)
  - after (string, optional): Pagination cursor

Returns live video details including title, status, views, and creation time.`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          broadcast_status: z.enum(["LIVE", "UNPUBLISHED", "SCHEDULED_UNPUBLISHED", "VOD"]).optional().describe("Filter by broadcast status"),
          limit: z.number().int().min(1).max(100).default(10),
          after: z.string().optional().describe("Pagination cursor for next page"),
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
    async ({ page_id, broadcast_status, limit, after, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const params: Record<string, unknown> = {
          fields: "id,title,status,embed_html,live_views,planned_start_time,creation_time",
          limit,
        };
        if (broadcast_status) params.broadcast_status = broadcast_status;
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string;
          title?: string;
          status?: string;
          embed_html?: string;
          live_views?: number;
          planned_start_time?: string;
          creation_time?: string;
        }>>(
          `/${page_id}/live_videos`,
          pageToken,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No live videos found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Live Videos (${data.data.length} shown)`, ""];
        for (const video of data.data) {
          lines.push(`## ${truncateField(video.title ?? "Untitled", 100)} (\`${video.id}\`)`);
          if (video.status) lines.push(`- **Status**: ${video.status}`);
          if (video.live_views != null) lines.push(`- **Live Views**: ${formatNumber(video.live_views)}`);
          if (video.planned_start_time) lines.push(`- **Scheduled**: ${formatDate(video.planned_start_time)}`);
          if (video.creation_time) lines.push(`- **Created**: ${formatDate(video.creation_time)}`);
          if (video.embed_html) lines.push(`- **Embed HTML**: ${truncateField(video.embed_html, 200)}`);
          lines.push("");
        }
        if (nextCursor) {
          lines.push(buildPaginationNote(data.data.length, nextCursor));
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "live videos") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── End Live Video ───────────────────────────────────────────────────────
  server.registerTool(
    "meta_end_live_video",
    {
      title: "End Facebook Live Video",
      description: `Ends an active live video broadcast.

Requires: meta_list_pages called first to load page tokens.

Args:
  - live_video_id (string): The live video ID to end
  - page_id (string): Facebook Page ID (needed for page token auth)

Ends the broadcast immediately.`,
      inputSchema: z
        .object({
          live_video_id: z.string().describe("The live video ID to end"),
          page_id: z.string().describe("Facebook Page ID (for auth)"),
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
    async ({ live_video_id, page_id, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const result = await client.post<{ success?: boolean }>(
          `/${live_video_id}`,
          { end_live_video: true },
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `Live video \`${live_video_id}\` ended successfully.`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Automated Responses ──────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_automated_responses",
    {
      title: "Get Page Automated Messaging Settings",
      description: `Gets the Facebook Page Messenger profile greeting and ice breakers.

Requires: meta_list_pages called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID

Returns: Messenger profile greeting and ice breakers. Instant and away replies are not exposed by this endpoint.`,
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
        const pageToken = client.requirePageToken(page_id);
        const data = await client.getWithToken<{ data: Array<Record<string, unknown>> }>(`/${page_id}/messenger_profile`, pageToken, {
          fields: "greeting,ice_breakers",
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `# Automated Messaging Settings for Page \`${page_id}\``,
          "",
        ];

        for (const profile of data.data ?? []) {
          if (Array.isArray(profile.greeting)) {
            lines.push("## Greeting");
            for (const greeting of profile.greeting as Array<{ locale: string; text: string }>) {
              lines.push(`- **${greeting.locale}**: ${greeting.text}`);
            }
            lines.push("");
          }
          if (Array.isArray(profile.ice_breakers)) {
            // Preserve locale/call_to_actions structure rather than assuming flat questions.
            lines.push("## Ice Breakers", "```json", JSON.stringify(profile.ice_breakers, null, 2), "```", "");
          }
        }

        if (lines.length === 2) {
          lines.push("_No automated messaging settings configured._");
        }

        return { content: [{ type: "text", text: truncate(lines.join("\n"), "automated responses") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Set Instant Reply ────────────────────────────────────────────────────
  server.registerTool(
    "meta_set_instant_reply",
    {
      title: "Set Page Instant Reply",
      description: `Sets the instant reply message for a Facebook Page. This is the automatic message sent immediately when someone messages the page.

Requires: meta_list_pages called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID
  - message (string): The instant reply message text
  - enabled (boolean, default true): Whether instant reply is enabled`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          message: z.string().min(1).describe("Instant reply message text"),
          enabled: z.boolean().default(true).describe("Enable or disable instant reply"),
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
    async ({ page_id, message, enabled, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const result = await client.post<Record<string, unknown>>(
          `/${page_id}/page_message_responses`,
          {
            page_set_instant_reply: { message: { text: message } },
            instant_reply_enabled: enabled,
          },
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `Instant reply ${enabled ? "enabled" : "disabled"} for page \`${page_id}\`.\n\n- **Message**: ${message}`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Set Away Message ─────────────────────────────────────────────────────
  server.registerTool(
    "meta_set_away_message",
    {
      title: "Set Page Away Message",
      description: `Sets the away message for a Facebook Page. This is shown when the page is set to away mode.

Requires: meta_list_pages called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID
  - message (string): The away message text
  - enabled (boolean, default true): Whether away mode is enabled`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          message: z.string().min(1).describe("Away message text"),
          enabled: z.boolean().default(true).describe("Enable or disable away mode"),
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
    async ({ page_id, message, enabled, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const result = await client.post<Record<string, unknown>>(
          `/${page_id}/page_message_responses`,
          {
            page_set_away_mode: { away_mode: { text: message } },
            away_setting_type: "custom",
            away_mode_enabled: enabled,
          },
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `Away message ${enabled ? "enabled" : "disabled"} for page \`${page_id}\`.\n\n- **Message**: ${message}`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Set Greeting ─────────────────────────────────────────────────────────
  server.registerTool(
    "meta_set_greeting",
    {
      title: "Set Page Messenger Greeting",
      description: `Sets the Messenger greeting text for a Facebook Page. This is shown to users before they send their first message.

Requires: meta_list_pages called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID
  - greeting_text (string): The greeting text (max 160 characters)`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          greeting_text: z.string().min(1).max(160).describe("Greeting text shown before first message"),
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
    async ({ page_id, greeting_text, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const result = await client.post<Record<string, unknown>>(
          `/${page_id}/thread_settings`,
          {
            greeting: [{ locale: "default", text: greeting_text }],
          },
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `Messenger greeting set for page \`${page_id}\`.\n\n- **Greeting**: ${greeting_text}`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Page Reel ──────────────────────────────────────────────────
  server.registerTool(
    "meta_publish_page_reel",
    {
      title: "Publish Facebook Page Reel",
      description: `Publishes a Reel (short-form video) to a Facebook Page.

Requires: meta_list_pages must be called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID
  - video_url (string): Public URL of the video file
  - description (string, optional): Reel description/caption
  - title (string, optional): Reel title

Returns: The reel/video ID on success.

Notes:
  - Video must be hosted on a publicly accessible server
  - FB Reels use a simpler single-step flow (no container polling needed)`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          video_url: z.string().url().describe("Public URL of the video file"),
          description: z.string().optional().describe("Reel description/caption"),
          title: z.string().optional().describe("Reel title"),
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
    async ({ page_id, video_url, description, title, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const fields: Record<string, unknown> = {
          source: video_url,
          video_state: "PUBLISHED",
        };
        if (description) fields.description = description;
        if (title) fields.title = title;

        const result = await client.post<{ id: string }>(
          `/${page_id}/video_reels`,
          fields,
          pageToken
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `Reel published to Facebook Page.\n\n- **Reel/Video ID**: \`${result.id}\``,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Cross-Post to Facebook + Instagram ─────────────────────────────────
  server.registerTool(
    "meta_cross_post",
    {
      title: "Cross-Post to Facebook Page & Instagram",
      description: `Publishes the same content to both a Facebook Page and Instagram simultaneously.

Requires: meta_list_pages must be called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID
  - ig_account_id (string): Instagram professional account ID
  - message (string): Text content (used as FB post text and IG caption)
  - image_url (string, optional): Public image URL — creates photo posts on both platforms
  - video_url (string, optional): Public video URL — creates Reels on both platforms

Logic:
  - If image_url: FB photo post + IG photo post (parallel)
  - If video_url: FB Reel + IG Reel (parallel)
  - If text only: FB text post only (IG doesn't support text-only posts)
  - Uses Promise.allSettled so one platform failing doesn't block the other

Returns: Results from both platforms (which succeeded, which failed).`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
          ig_account_id: z.string().describe("Instagram professional account ID"),
          message: z.string().min(1).describe("Text content / caption for both platforms"),
          image_url: z.string().url().optional().describe("Public image URL for photo posts"),
          video_url: z.string().url().optional().describe("Public video URL for Reels"),
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
    async ({ page_id, ig_account_id, message, image_url, video_url, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);

        const fbPromise = (async (): Promise<{ platform: string; id: string }> => {
          if (image_url) {
            const result = await client.post<{ id: string; post_id?: string }>(
              `/${page_id}/photos`,
              { url: image_url, message },
              pageToken
            );
            return { platform: "Facebook Photo", id: result.post_id ?? result.id };
          } else if (video_url) {
            const result = await client.post<{ id: string }>(
              `/${page_id}/video_reels`,
              { source: video_url, video_state: "PUBLISHED", description: message },
              pageToken
            );
            return { platform: "Facebook Reel", id: result.id };
          } else {
            const result = await client.post<{ id: string }>(
              `/${page_id}/feed`,
              { message },
              pageToken
            );
            return { platform: "Facebook Post", id: result.id };
          }
        })();

        const igPromise = (async (): Promise<{ platform: string; id: string } | null> => {
          if (image_url) {
            const container = await client.post<{ id: string }>(
              `/${ig_account_id}/media`,
              { image_url, caption: message }
            );
            const result = await client.post<{ id: string }>(
              `/${ig_account_id}/media_publish`,
              { creation_id: container.id }
            );
            return { platform: "Instagram Photo", id: result.id };
          } else if (video_url) {
            const container = await client.post<{ id: string }>(
              `/${ig_account_id}/media`,
              { media_type: "REELS", video_url, caption: message, share_to_feed: true }
            );
            const statusCode = await client.pollContainerStatus(container.id, "instagram");
            if (statusCode !== "FINISHED") {
              throw new Error(`Instagram container status: ${statusCode} (not FINISHED)`);
            }
            const result = await client.post<{ id: string }>(
              `/${ig_account_id}/media_publish`,
              { creation_id: container.id }
            );
            return { platform: "Instagram Reel", id: result.id };
          } else {
            return null;
          }
        })();

        const [fbResult, igResult] = await Promise.allSettled([fbPromise, igPromise]);

        if (response_format === "json") {
          const json = {
            facebook: fbResult.status === "fulfilled" ? { success: true, ...fbResult.value } : { success: false, error: (fbResult as PromiseRejectedResult).reason?.message ?? String((fbResult as PromiseRejectedResult).reason) },
            instagram: igResult.status === "fulfilled" ? (igResult.value ? { success: true, ...igResult.value } : { success: true, skipped: true, reason: "Text-only posts not supported on Instagram" }) : { success: false, error: (igResult as PromiseRejectedResult).reason?.message ?? String((igResult as PromiseRejectedResult).reason) },
          };
          return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] };
        }

        const lines = ["# Cross-Post Results", ""];

        if (fbResult.status === "fulfilled") {
          lines.push(`**${fbResult.value.platform}**: Published — ID \`${fbResult.value.id}\``);
        } else {
          lines.push(`**Facebook**: Failed — ${(fbResult as PromiseRejectedResult).reason?.message ?? "Unknown error"}`);
        }

        if (igResult.status === "fulfilled") {
          if (igResult.value) {
            lines.push(`**${igResult.value.platform}**: Published — ID \`${igResult.value.id}\``);
          } else {
            lines.push("**Instagram**: Skipped (text-only posts not supported on Instagram)");
          }
        } else {
          lines.push(`**Instagram**: Failed — ${(igResult as PromiseRejectedResult).reason?.message ?? "Unknown error"}`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
