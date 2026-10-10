import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { THREADS_PROFILE_FIELDS, THREADS_MEDIA_FIELDS } from "../../constants.js";
import { ThreadsProfile, ThreadsMedia, MetaPaginatedResponse } from "../../types.js";
import { ThreadsReplyControlSchema } from "./schemas.js";

export function registerThreadsPublishingTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Threads Profile ──────────────────────────────────────────────────
  server.registerTool(
    "threads_get_profile",
    {
      title: "Get Threads Profile",
      description: `Gets the authenticated user's Threads profile.

Returns: User ID, username, name, bio, and profile picture URL.

Requires: THREADS_ACCESS_TOKEN env var.`,
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
        const profile = await client.threadsGet<ThreadsProfile>("/me", {
          fields: THREADS_PROFILE_FIELDS,
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
        }

        const lines = [
          `# Threads Profile`,
          "",
          `- **Username**: @${profile.username ?? "unknown"}`,
          `- **Name**: ${profile.name ?? "N/A"}`,
          `- **ID**: \`${profile.id}\``,
          profile.threads_biography ? `- **Bio**: ${profile.threads_biography}` : "",
        ].filter(Boolean);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Threads Posts ────────────────────────────────────────────────────
  server.registerTool(
    "threads_get_posts",
    {
      title: "Get Threads Posts",
      description: `Lists the authenticated user's Threads posts.

Args:
  - threads_user_id (string): Threads user ID (from threads_get_profile)
  - limit (number): Max results (1–100, default 20)
  - since (string, optional): Start date YYYY-MM-DD
  - until (string, optional): End date YYYY-MM-DD
  - after (string, optional): Pagination cursor`,
      inputSchema: z
        .object({
          threads_user_id: z.string().describe("Threads user ID"),
          limit: z.number().int().min(1).max(100).default(20),
          since: z.string().optional(),
          until: z.string().optional(),
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
    async ({ threads_user_id, limit, since, until, after, response_format }) => {
      try {
        const params: Record<string, unknown> = { fields: THREADS_MEDIA_FIELDS, limit };
        if (since) params.since = since;
        if (until) params.until = until;
        if (after) params.after = after;

        const data = await client.threadsGet<MetaPaginatedResponse<ThreadsMedia>>(
          `/${threads_user_id}/threads`,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No threads posts found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Threads Posts (${data.data.length} shown)`, ""];
        for (const post of data.data) {
          lines.push(`## ${post.media_type ?? "TEXT"} \`${post.id}\``);
          if (post.text) lines.push(`> ${truncateField(post.text, 200)}`);
          if (post.timestamp) lines.push(`- **Posted**: ${formatDate(post.timestamp)}`);
          if (post.permalink) lines.push(`- **Link**: ${post.permalink}`);
          if (post.is_quote_post) lines.push(`- **Quote post**`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "threads") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Text Thread ──────────────────────────────────────────────────
  server.registerTool(
    "threads_publish_text",
    {
      title: "Publish Text Thread",
      description: `Publishes a text-only post to Threads.

Two-step flow: creates a container, then publishes it.

Args:
  - threads_user_id (string): Threads user ID
  - text (string): Post text (up to 500 characters)
  - reply_to_id (string, optional): Thread ID to reply to
  - quote_post_id (string, optional): Thread ID to quote

Returns: Media ID of the published thread.`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
          text: z.string().min(1).max(500).describe("Post text"),
          reply_to_id: z.string().optional().describe("Thread ID to reply to"),
          quote_post_id: z.string().optional().describe("Thread ID to quote"),
          reply_control: ThreadsReplyControlSchema.optional(),
          location_id: z.string().optional().describe("Location ID to tag (from Facebook Places search)"),
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
    async ({ threads_user_id, text, reply_to_id, quote_post_id, reply_control, location_id, response_format }) => {
      try {
        const fields: Record<string, unknown> = { media_type: "TEXT", text };
        if (reply_to_id) fields.reply_to_id = reply_to_id;
        if (quote_post_id) fields.quote_post_id = quote_post_id;
        if (reply_control) fields.reply_control = reply_control;
        if (location_id) fields.location_id = location_id;

        const container = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads`,
          fields
        );

        const result = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads_publish`,
          { creation_id: container.id }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{ type: "text", text: `Thread published.\n\n- **Media ID**: \`${result.id}\`` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Image Thread ─────────────────────────────────────────────────
  server.registerTool(
    "threads_publish_image",
    {
      title: "Publish Image Thread",
      description: `Publishes an image post to Threads.

Args:
  - threads_user_id (string): Threads user ID
  - image_url (string): Public URL of the image (JPEG or PNG)
  - text (string, optional): Caption text`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
          image_url: z.string().url().describe("Public image URL"),
          text: z.string().optional().describe("Caption text"),
          reply_control: ThreadsReplyControlSchema.optional(),
          location_id: z.string().optional().describe("Location ID to tag (from Facebook Places search)"),
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
    async ({ threads_user_id, image_url, text, reply_control, location_id, response_format }) => {
      try {
        const fields: Record<string, unknown> = { media_type: "IMAGE", image_url };
        if (text) fields.text = text;
        if (reply_control) fields.reply_control = reply_control;
        if (location_id) fields.location_id = location_id;

        const container = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads`,
          fields
        );

        const result = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads_publish`,
          { creation_id: container.id }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{ type: "text", text: `Image thread published.\n\n- **Media ID**: \`${result.id}\`` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Video Thread ─────────────────────────────────────────────────
  server.registerTool(
    "threads_publish_video",
    {
      title: "Publish Video Thread",
      description: `Publishes a video post to Threads.

Args:
  - threads_user_id (string): Threads user ID
  - video_url (string): Public URL of the video (MP4)
  - text (string, optional): Caption text

Note: Video processing may take time. Polls for up to 60 seconds.`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
          video_url: z.string().url().describe("Public video URL"),
          text: z.string().optional(),
          reply_control: ThreadsReplyControlSchema.optional(),
          location_id: z.string().optional().describe("Location ID to tag (from Facebook Places search)"),
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
    async ({ threads_user_id, video_url, text, reply_control, location_id, response_format }) => {
      try {
        const fields: Record<string, unknown> = { media_type: "VIDEO", video_url };
        if (text) fields.text = text;
        if (reply_control) fields.reply_control = reply_control;
        if (location_id) fields.location_id = location_id;

        const container = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads`,
          fields
        );

        // Poll for video processing
        const statusCode = await client.pollContainerStatus(container.id, "threads");

        if (statusCode !== "FINISHED") {
          return {
            content: [{
              type: "text",
              text: `Container created (\`${container.id}\`) but video status: ${statusCode}. Wait and retry — video processing can take up to 60 seconds.`,
            }],
          };
        }

        const result = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads_publish`,
          { creation_id: container.id }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{ type: "text", text: `Video thread published.\n\n- **Media ID**: \`${result.id}\`` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Publish Carousel Thread ──────────────────────────────────────────────
  server.registerTool(
    "threads_publish_carousel",
    {
      title: "Publish Carousel Thread",
      description: `Publishes a carousel post (2–20 images/videos) to Threads.

Three-step flow:
1. Create individual item containers
2. Create carousel container referencing them
3. Publish

Args:
  - threads_user_id (string): Threads user ID
  - items (array): 2–20 items, each with url (string) and type ('IMAGE' or 'VIDEO')
  - text (string, optional): Caption text`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
          items: z
            .array(
              z.object({
                url: z.string().url(),
                type: z.enum(["IMAGE", "VIDEO"]),
              })
            )
            .min(2)
            .max(20),
          text: z.string().optional(),
          reply_control: ThreadsReplyControlSchema.optional(),
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
    async ({ threads_user_id, items, text, reply_control, response_format }) => {
      try {
        // Step 1: Create all item containers in parallel
        const results = await Promise.allSettled(
          items.map(async (item) => {
            const fields: Record<string, unknown> = {
              media_type: item.type,
              is_carousel_item: true,
              ...(item.type === "IMAGE" ? { image_url: item.url } : { video_url: item.url }),
            };
            return { ...(await client.threadsPost<{ id: string }>(`/${threads_user_id}/threads`, fields)), type: item.type as string };
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
            videoContainers.map((c) => client.pollContainerStatus(c.id, "threads"))
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
        if (text) carouselFields.text = text;
        if (reply_control) carouselFields.reply_control = reply_control;

        const carousel = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads`,
          carouselFields
        );

        // Step 3: Publish
        const result = await client.threadsPost<{ id: string }>(
          `/${threads_user_id}/threads_publish`,
          { creation_id: carousel.id }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `Carousel thread published (${items.length} items).\n\n- **Media ID**: \`${result.id}\``,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delete Thread ────────────────────────────────────────────────────────
  server.registerTool(
    "threads_delete_post",
    {
      title: "Delete Thread",
      description: `Deletes a Threads post permanently.

Args:
  - media_id (string): Threads media ID to delete`,
      inputSchema: z
        .object({
          media_id: z.string().describe("Threads media ID"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ media_id }) => {
      try {
        const result = await client.threadsDelete<{ success: boolean }>(`/${media_id}`);
        return {
          content: [{
            type: "text",
            text: result.success
              ? `Thread \`${media_id}\` deleted.`
              : `Failed to delete thread \`${media_id}\`.`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
