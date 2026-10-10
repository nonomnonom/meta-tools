import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatNumber, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { IG_MEDIA_FIELDS } from "../../constants.js";
import { InstagramAccount, InstagramMedia, InstagramComment, MetaPaginatedResponse } from "../../types.js";

export function registerInstagramDiscoveryTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Instagram Comments ───────────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_comments",
    {
      title: "Get Instagram Comments",
      description: `Gets comments on an Instagram media object.

Args:
  - media_id (string): Instagram media ID
  - limit (number): Max comments to return (1–100, default 20)`,
      inputSchema: z
        .object({
          media_id: z.string(),
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
    async ({ media_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,text,username,timestamp,from",
          limit,
        };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<InstagramComment>>(
          `/${media_id}/comments`,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No comments on this media." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Comments on \`${media_id}\` (${data.data.length})`, ""];
        for (const c of data.data) {
          lines.push(`**@${c.username ?? c.from?.username ?? "unknown"}** (${formatDate(c.timestamp)})`);
          lines.push(`> ${c.text}`);
          lines.push(`_ID: \`${c.id}\`_`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "comments") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Reply to Comment ─────────────────────────────────────────────────────
  server.registerTool(
    "meta_reply_instagram_comment",
    {
      title: "Reply to Instagram Comment",
      description: `Replies to a comment on an Instagram media object.

Args:
  - media_id (string): Instagram media ID (not the comment ID)
  - message (string): Reply text
  - comment_id (string, optional): If replying to a specific comment

Returns: Comment ID of the reply.`,
      inputSchema: z
        .object({
          media_id: z.string().describe("Instagram media ID"),
          message: z.string().min(1).describe("Reply text"),
          comment_id: z
            .string()
            .optional()
            .describe("Comment ID to reply to (for threaded replies)"),
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
    async ({ media_id, message, comment_id, response_format }) => {
      try {
        // If replying to a specific comment, POST to /{comment_id}/replies
        // Otherwise, POST a new top-level comment to /{media_id}/comments
        const endpoint = comment_id ? `/${comment_id}/replies` : `/${media_id}/comments`;

        const result = await client.post<{ id: string }>(
          endpoint,
          { message }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `Comment posted successfully.\n\n- **Comment ID**: \`${result.id}\``,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Search Instagram Hashtags ───────────────────────────────────────────
  server.registerTool(
    "meta_search_instagram_hashtag",
    {
      title: "Search Instagram Hashtag",
      description: `Searches for a hashtag and gets its ID, then retrieves top or recent media.

Two-step process: first looks up the hashtag ID, then fetches media.

Args:
  - ig_account_id (string): Instagram account ID (required for auth context)
  - hashtag (string): Hashtag to search (without #)
  - edge (string): 'top_media' or 'recent_media' (default: top_media)
  - limit (number): Max results (1–50, default 20)

Note: Limited to 30 unique hashtag searches per 7 days per IG account.`,
      inputSchema: z
        .object({
          ig_account_id: z.string(),
          hashtag: z.string().min(1).describe("Hashtag without # symbol"),
          edge: z.enum(["top_media", "recent_media"]).default("top_media"),
          limit: z.number().int().min(1).max(50).default(20),
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
    async ({ ig_account_id, hashtag, edge, limit, response_format }) => {
      try {
        // Step 1: Look up hashtag ID
        const hashtagResult = await client.get<{ data: Array<{ id: string }> }>(
          "/ig_hashtag_search",
          { user_id: ig_account_id, q: hashtag }
        );

        if (!hashtagResult.data?.length) {
          return { content: [{ type: "text", text: `Hashtag #${hashtag} not found.` }] };
        }

        const hashtagId = hashtagResult.data[0].id;

        // Step 2: Get media
        const data = await client.get<MetaPaginatedResponse<InstagramMedia>>(
          `/${hashtagId}/${edge}`,
          { user_id: ig_account_id, fields: "id,media_type,media_url,permalink,caption,like_count,comments_count,timestamp", limit }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: `No ${edge} found for #${hashtag}.` }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify({ hashtag_id: hashtagId, ...data }, null, 2) }] };
        }

        const lines = [`# #${hashtag} — ${edge === "top_media" ? "Top" : "Recent"} Media (${data.data.length})`, `**Hashtag ID**: \`${hashtagId}\``, ""];
        for (const media of data.data) {
          lines.push(`## ${media.media_type} \`${media.id}\``);
          if (media.caption) lines.push(`> ${truncateField(media.caption, 150)}`);
          if (media.like_count !== undefined) lines.push(`- **Likes**: ${formatNumber(media.like_count)} | **Comments**: ${formatNumber(media.comments_count)}`);
          if (media.permalink) lines.push(`- ${media.permalink}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "hashtag media") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Instagram User (Business Discovery) ──────────────────────────
  server.registerTool(
    "meta_get_instagram_user",
    {
      title: "Get Instagram User Info",
      description: `Gets public profile info for any Instagram business/creator account by username.

Uses the Business Discovery API — no follow/connection required.

Args:
  - ig_account_id (string): Your Instagram account ID (for auth)
  - username (string): Instagram username to look up (without @)

Returns: Bio, follower/following counts, media count, profile picture, and recent media.`,
      inputSchema: z
        .object({
          ig_account_id: z.string().describe("Your Instagram account ID"),
          username: z.string().min(1).describe("Username to look up (without @)"),
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
    async ({ ig_account_id, username, response_format }) => {
      try {
        // Business Discovery API syntax: business_discovery.username(TARGET){requested_fields}
        // Per Meta docs: GET /{ig-user-id}?fields=business_discovery.username(bluebottle){followers_count,...}
        const bdFields = `id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website,media.limit(5){${IG_MEDIA_FIELDS}}`;
        const data = await client.get<{
          business_discovery: InstagramAccount & {
            media?: { data: InstagramMedia[] };
          };
        }>(`/${ig_account_id}`, {
          fields: `business_discovery.username(${username}){${bdFields}}`,
        });

        const user = data.business_discovery;
        if (!user) {
          return { content: [{ type: "text", text: `User @${username} not found or not a business/creator account.` }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(user, null, 2) }] };
        }

        const lines = [
          `# @${user.username ?? username}`,
          "",
          `- **Name**: ${user.name ?? "N/A"}`,
          `- **Followers**: ${formatNumber(user.followers_count)}`,
          `- **Following**: ${formatNumber(user.follows_count)}`,
          `- **Posts**: ${formatNumber(user.media_count)}`,
          user.biography ? `- **Bio**: ${user.biography}` : "",
          user.website ? `- **Website**: ${user.website}` : "",
        ].filter(Boolean);

        if (user.media?.data?.length) {
          lines.push("", "## Recent Posts");
          for (const m of user.media.data) {
            lines.push(`- \`${m.id}\` ${m.media_type} — ${truncateField(m.caption, 80) || "No caption"}${m.permalink ? ` (${m.permalink})` : ""}`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Instagram Stories ──────────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_stories",
    {
      title: "Get Instagram Stories",
      description: `Gets currently active stories for an Instagram professional account.

Args:
  - ig_account_id (string): Instagram account ID

Returns: List of active story media objects. Stories expire after 24 hours.`,
      inputSchema: z
        .object({
          ig_account_id: z.string().describe("Instagram account ID"),
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
    async ({ ig_account_id, response_format }) => {
      try {
        const data = await client.get<MetaPaginatedResponse<InstagramMedia>>(
          `/${ig_account_id}/stories`,
          { fields: IG_MEDIA_FIELDS }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No active stories found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Active Stories (${data.data.length})`, ""];
        for (const media of data.data) {
          lines.push(`## ${media.media_type} \`${media.id}\``);
          if (media.timestamp) lines.push(`- **Posted**: ${formatDate(media.timestamp)}`);
          if (media.permalink) lines.push(`- **Link**: ${media.permalink}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
