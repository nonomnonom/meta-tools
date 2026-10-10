import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { CREATIVE_FIELDS } from "../../constants.js";
import { Ad, AdCreative, MetaPaginatedResponse } from "../../types.js";

export function registerCreativeTools(server: McpServer, client: MetaApiClient): void {
  // ─── List Ad Creatives ────────────────────────────────────────────────────
  server.registerTool(
    "meta_list_ad_creatives",
    {
      title: "List Ad Creatives",
      description: `Lists ad creatives for an ad account.

Args:
  - ad_account_id (string): Ad account ID
  - limit (number): Max results (default 20)
  - after (string, optional): Pagination cursor

Returns creative IDs, names, and associated page post IDs.`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
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
    async ({ ad_account_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = { fields: CREATIVE_FIELDS, limit };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<AdCreative>>(
          `/${ad_account_id}/adcreatives`,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No creatives found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Ad Creatives (${data.data.length} shown)`, ""];
        for (const cr of data.data) {
          lines.push(`## ${cr.name ?? "Unnamed"} (\`${cr.id}\`)`);
          if (cr.title) lines.push(`- **Title**: ${cr.title}`);
          if (cr.body) lines.push(`- **Body**: ${truncateField(cr.body, 150)}`);
          if (cr.object_type) lines.push(`- **Type**: ${cr.object_type}`);
          if (cr.object_story_id) lines.push(`- **Post ID**: \`${cr.object_story_id}\``);
          if (cr.image_url) lines.push(`- **Image**: ${cr.image_url}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "creatives") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Ad Creative ───────────────────────────────────────────────────
  server.registerTool(
    "meta_create_ad_creative",
    {
      title: "Create Ad Creative",
      description: `Creates an ad creative from an existing Facebook Page post.

Args:
  - ad_account_id (string): Ad account ID
  - name (string): Creative name
  - page_id (string): Facebook Page ID that owns the post
  - object_story_id (string, optional): Use an existing published post as creative (format: {page_id}_{post_id})
  - title (string, optional): Ad headline
  - body (string, optional): Ad body text
  - image_url (string, optional): Image URL for the creative
  - link_url (string, optional): Destination URL

Returns the new creative ID.`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          name: z.string().min(1),
          page_id: z.string().describe("Facebook Page ID"),
          object_story_id: z.string().optional().describe("Existing post ID as {page_id}_{post_id}"),
          title: z.string().optional(),
          body: z.string().optional(),
          image_url: z.string().url().optional(),
          link_url: z.string().url().optional(),
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
    async ({ ad_account_id, name, page_id, object_story_id, title, body, image_url, link_url, response_format }) => {
      try {
        const fields: Record<string, unknown> = { name };

        if (object_story_id) {
          fields.object_story_id = object_story_id;
        } else {
          // Build object_story_spec for new creative
          const linkData: Record<string, unknown> = {};
          if (title) linkData.name = title;
          if (body) linkData.description = body;
          if (image_url) linkData.picture = image_url;
          if (link_url) linkData.link = link_url;

          fields.object_story_spec = {
            page_id,
            link_data: linkData,
          };
        }

        const result = await client.post<{ id: string }>(
          `/${ad_account_id}/adcreatives`,
          fields
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `Ad creative created successfully.\n\n- **Creative ID**: \`${result.id}\`\n- **Name**: ${name}`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Ad Preview ────────────────────────────────────────────────────
  server.registerTool(
    "meta_get_ad_preview",
    {
      title: "Get Ad Preview",
      description: `Generates a preview URL for an ad or creative.

Args:
  - ad_id (string, optional): Existing ad ID
  - creative_id (string, optional): Creative ID to preview
  - ad_format (string): Preview format — DESKTOP_FEED_STANDARD, MOBILE_FEED_STANDARD, INSTAGRAM_STANDARD, INSTAGRAM_STORY, RIGHT_COLUMN_STANDARD

Provide either ad_id or creative_id.`,
      inputSchema: z
        .object({
          ad_id: z.string().optional(),
          creative_id: z.string().optional(),
          ad_format: z
            .enum([
              "DESKTOP_FEED_STANDARD",
              "MOBILE_FEED_STANDARD",
              "INSTAGRAM_STANDARD",
              "INSTAGRAM_STORY",
              "RIGHT_COLUMN_STANDARD",
              "MARKETPLACE_MOBILE",
              "AUDIENCE_NETWORK_OUTSTREAM_VIDEO",
            ])
            .default("MOBILE_FEED_STANDARD"),
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
    async ({ ad_id, creative_id, ad_format, response_format }) => {
      try {
        const targetId = ad_id ?? creative_id;
        if (!targetId) {
          return { content: [{ type: "text", text: "Error: Provide ad_id or creative_id." }], isError: true };
        }

        const data = await client.get<{ data: Array<{ body: string }> }>(
          `/${targetId}/previews`,
          { ad_format }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const preview = data.data?.[0]?.body ?? "No preview available.";
        return { content: [{ type: "text", text: `# Ad Preview (${ad_format})\n\n${preview}` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delete Ad ─────────────────────────────────────────────────────────
  server.registerTool(
    "meta_delete_ad",
    {
      title: "Delete Ad",
      description: `Deletes an ad permanently.

Args:
  - ad_id (string): Ad ID to delete`,
      inputSchema: z
        .object({
          ad_id: z.string(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ ad_id }) => {
      try {
        const result = await client.delete<{ success: boolean }>(`/${ad_id}`);
        return {
          content: [{
            type: "text",
            text: result.success ? `Ad \`${ad_id}\` deleted.` : `Failed to delete ad \`${ad_id}\`.`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delete Ad Set ─────────────────────────────────────────────────────
  server.registerTool(
    "meta_delete_adset",
    {
      title: "Delete Ad Set",
      description: `Deletes an ad set permanently.

Args:
  - adset_id (string): Ad set ID to delete`,
      inputSchema: z
        .object({
          adset_id: z.string(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ adset_id }) => {
      try {
        const result = await client.delete<{ success: boolean }>(`/${adset_id}`);
        return {
          content: [{
            type: "text",
            text: result.success ? `Ad set \`${adset_id}\` deleted.` : `Failed to delete ad set \`${adset_id}\`.`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Ad Account Users ──────────────────────────────────────────────
  server.registerTool(
    "meta_get_ad_account_users",
    {
      title: "Get Ad Account Users",
      description: `Lists users who have access to an ad account with their roles.

Args:
  - ad_account_id (string): Ad account ID (e.g., act_123456789)`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
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
    async ({ ad_account_id, response_format }) => {
      try {
        const data = await client.get<MetaPaginatedResponse<{
          id: string;
          name: string;
          role: number;
          permissions: string[];
        }>>(`/${ad_account_id}/users`, {
          fields: "id,name,role,permissions",
        });

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No users found for this ad account." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const roleMap: Record<number, string> = { 1001: "Admin", 1002: "Advertiser", 1003: "Analyst" };
        const lines = [`# Ad Account Users (${data.data.length})`, ""];
        for (const user of data.data) {
          lines.push(`- **${user.name}** (\`${user.id}\`) — ${roleMap[user.role] ?? `Role ${user.role}`}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Upload Ad Image ───────────────────────────────────────────────────
  server.registerTool(
    "meta_upload_ad_image",
    {
      title: "Upload Ad Image",
      description: `Uploads an image to an ad account's image library for use in creatives.

Args:
  - ad_account_id (string): Ad account ID
  - url (string): Public URL of the image to upload
  - name (string, optional): Name for the uploaded image

Returns: Image hash (used when creating ad creatives).`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          url: z.string().url().describe("Public image URL"),
          name: z.string().optional(),
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
    async ({ ad_account_id, url, name, response_format }) => {
      try {
        const fields: Record<string, unknown> = { url };
        if (name) fields.name = name;

        const result = await client.post<{ images: Record<string, { hash: string; url: string }> }>(
          `/${ad_account_id}/adimages`,
          fields
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        const images = Object.values(result.images ?? {});
        const img = images[0];
        return {
          content: [{
            type: "text",
            text: img
              ? `Image uploaded.\n\n- **Hash**: \`${img.hash}\`\n- **URL**: ${img.url}`
              : "Image upload response received but no hash returned.",
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
