import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatNumber, formatDate, formatBudget, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { AD_ACCOUNT_FIELDS, ADSET_FIELDS, AD_FIELDS, CREATIVE_FIELDS } from "../../constants.js";
import { AdAccount, Campaign, AdSet, Ad, AdCreative, MetaPaginatedResponse } from "../../types.js";

export function registerAdAccountAssetTools(server: McpServer, client: MetaApiClient): void {
  // ─── List Ad Videos ────────────────────────────────────────────────────
  server.registerTool(
    "meta_list_ad_videos",
    {
      title: "List Ad Videos",
      description: `Lists videos in an ad account's video library.

Args:
  - ad_account_id (string): Ad account ID
  - limit (number): Max results (default 20)`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          limit: z.number().int().min(1).max(100).default(20),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ad_account_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,title,length,created_time,updated_time,thumbnails,permalink_url",
          limit,
        };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<{
          id: string; title?: string; length?: number; created_time?: string; permalink_url?: string;
        }>>(`/${ad_account_id}/advideos`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No ad videos found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Ad Videos (${data.data.length})`, ""];
        for (const v of data.data) {
          lines.push(`- **${v.title ?? "Untitled"}** (\`${v.id}\`)${v.length ? ` — ${Math.round(v.length)}s` : ""}${v.created_time ? ` | ${formatDate(v.created_time)}` : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Upload Ad Video ───────────────────────────────────────────────────
  server.registerTool(
    "meta_upload_ad_video",
    {
      title: "Upload Ad Video",
      description: `Uploads a video to an ad account's video library for use in creatives.

Args:
  - ad_account_id (string): Ad account ID
  - file_url (string): Public URL of video file
  - title (string, optional): Video title
  - description (string, optional): Video description`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          file_url: z.string().url(),
          title: z.string().optional(),
          description: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ad_account_id, file_url, title, description, response_format }) => {
      try {
        const fields: Record<string, unknown> = { file_url };
        if (title) fields.title = title;
        if (description) fields.description = description;

        const result = await client.post<{ id: string }>(`/${ad_account_id}/advideos`, fields);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Video uploaded.\n\n- **Video ID**: \`${result.id}\`` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Ad Account Activity Log ───────────────────────────────────────
  server.registerTool(
    "meta_get_ad_account_activity",
    {
      title: "Get Ad Account Activity Log",
      description: `Gets the activity/change log for an ad account.

Args:
  - ad_account_id (string): Ad account ID
  - limit (number): Max results (default 25)
  - since (string, optional): Start date YYYY-MM-DD
  - until (string, optional): End date YYYY-MM-DD`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          limit: z.number().int().min(1).max(100).default(25),
          since: z.string().optional(),
          until: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ad_account_id, limit, since, until, response_format }) => {
      try {
        const params: Record<string, unknown> = { limit };
        if (since) params.since = since;
        if (until) params.until = until;

        const data = await client.get<MetaPaginatedResponse<{
          event_type: string;
          event_time: string;
          actor_id?: string;
          actor_name?: string;
          object_id?: string;
          object_name?: string;
          extra_data?: string;
        }>>(`/${ad_account_id}/activities`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No activity found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Ad Account Activity (${data.data.length})`, ""];
        for (const act of data.data) {
          lines.push(`- **${act.event_type}** by ${act.actor_name ?? act.actor_id ?? "unknown"} (${formatDate(act.event_time)})${act.object_name ? ` — ${act.object_name}` : ""}`);
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "activities") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Ad Account Details ────────────────────────────────────────────
  server.registerTool(
    "meta_get_ad_account",
    {
      title: "Get Ad Account Details",
      description: `Gets detailed information about a specific ad account.

Args:
  - ad_account_id (string): Ad account ID (e.g., act_123456789)`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ ad_account_id, response_format }) => {
      try {
        const data = await client.get<AdAccount>(`/${ad_account_id}`, {
          fields: AD_ACCOUNT_FIELDS,
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const statusMap: Record<number, string> = { 1: "Active", 2: "Disabled", 3: "Unsettled", 7: "Pending Review", 8: "Pending Closure", 9: "In Grace Period", 100: "Closed", 101: "Any Active", 201: "Any Closed" };
        const lines = [
          `# ${data.name ?? "Ad Account"}`,
          "",
          `- **ID**: \`${data.id}\``,
          `- **Account ID**: ${data.account_id}`,
          `- **Status**: ${statusMap[data.account_status ?? 0] ?? `Unknown (${data.account_status})`}`,
          `- **Currency**: ${data.currency}`,
          `- **Timezone**: ${data.timezone_name}`,
          data.amount_spent ? `- **Total Spent**: ${formatBudget(data.amount_spent, undefined, data.currency)}` : "",
          data.balance ? `- **Balance**: ${formatBudget(data.balance, undefined, data.currency)}` : "",
          data.spend_cap ? `- **Spend Cap**: ${formatBudget(data.spend_cap, undefined, data.currency)}` : "",
          data.business ? `- **Business**: ${data.business.name} (\`${data.business.id}\`)` : "",
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Single Ad Set ─────────────────────────────────────────────────
  server.registerTool(
    "meta_get_adset",
    {
      title: "Get Ad Set Details",
      description: `Gets detailed information about a specific ad set.

Args:
  - adset_id (string): Ad set ID`,
      inputSchema: z
        .object({
          adset_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ adset_id, response_format }) => {
      try {
        const data = await client.get<AdSet>(`/${adset_id}`, { fields: ADSET_FIELDS });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `# Ad Set: ${data.name}`,
          "",
          `- **ID**: \`${data.id}\``,
          `- **Campaign**: \`${data.campaign_id}\``,
          `- **Status**: ${data.effective_status ?? data.status}`,
          `- **Budget**: ${formatBudget(data.daily_budget, data.lifetime_budget)}`,
          data.billing_event ? `- **Billing**: ${data.billing_event}` : "",
          data.optimization_goal ? `- **Optimization**: ${data.optimization_goal}` : "",
          data.start_time ? `- **Start**: ${formatDate(data.start_time)}` : "",
          data.end_time ? `- **End**: ${formatDate(data.end_time)}` : "",
          data.targeting ? `- **Targeting**: ${truncateField(JSON.stringify(data.targeting), 200)}` : "",
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Single Ad ─────────────────────────────────────────────────────
  server.registerTool(
    "meta_get_ad",
    {
      title: "Get Ad Details",
      description: `Gets detailed information about a specific ad.

Args:
  - ad_id (string): Ad ID`,
      inputSchema: z
        .object({
          ad_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ ad_id, response_format }) => {
      try {
        const data = await client.get<Ad>(`/${ad_id}`, { fields: AD_FIELDS });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `# Ad: ${data.name}`,
          "",
          `- **ID**: \`${data.id}\``,
          `- **Ad Set**: \`${data.adset_id}\``,
          `- **Campaign**: \`${data.campaign_id}\``,
          `- **Status**: ${data.effective_status ?? data.status}`,
          data.creative?.id ? `- **Creative**: \`${data.creative.id}\`` : "",
          data.preview_shareable_link ? `- **Preview**: ${data.preview_shareable_link}` : "",
          data.created_time ? `- **Created**: ${formatDate(data.created_time)}` : "",
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Single Creative ───────────────────────────────────────────────
  server.registerTool(
    "meta_get_ad_creative",
    {
      title: "Get Ad Creative Details",
      description: `Gets detailed information about a specific ad creative.

Args:
  - creative_id (string): Creative ID`,
      inputSchema: z
        .object({
          creative_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ creative_id, response_format }) => {
      try {
        const data = await client.get<AdCreative>(`/${creative_id}`, { fields: CREATIVE_FIELDS });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `# Creative: ${data.name ?? "Unnamed"}`,
          "",
          `- **ID**: \`${data.id}\``,
          data.title ? `- **Title**: ${data.title}` : "",
          data.body ? `- **Body**: ${data.body}` : "",
          data.image_url ? `- **Image**: ${data.image_url}` : "",
          data.object_story_id ? `- **Story ID**: \`${data.object_story_id}\`` : "",
          data.object_type ? `- **Type**: ${data.object_type}` : "",
          data.status ? `- **Status**: ${data.status}` : "",
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Ad Rule ────────────────────────────────────────────────────
  server.registerTool(
    "meta_create_ad_rule",
    {
      title: "Create Automated Ad Rule",
      description: `Creates an automated rule for managing ads, ad sets, or campaigns.

Args:
  - ad_account_id (string): Ad account ID
  - name (string): Rule name
  - evaluation_spec (object): Conditions that trigger the rule (e.g., {"evaluation_type":"TRIGGER","trigger":{"type":"STATS_CHANGE","field":"cost_per_result","value":"5.00","operator":"GREATER_THAN"}})
  - execution_spec (object): Actions to take (e.g., {"execution_type":"PAUSE"})
  - schedule_spec (object, optional): When to evaluate (e.g., {"schedule_type":"DAILY"})`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          name: z.string().min(1),
          evaluation_spec: z.record(z.string(), z.unknown()),
          execution_spec: z.record(z.string(), z.unknown()),
          schedule_spec: z.record(z.string(), z.unknown()).optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ad_account_id, name, evaluation_spec, execution_spec, schedule_spec, response_format }) => {
      try {
        const fields: Record<string, unknown> = { name, evaluation_spec, execution_spec };
        if (schedule_spec) fields.schedule_spec = schedule_spec;

        const result = await client.post<{ id: string }>(`/${ad_account_id}/adrules_library`, fields);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Ad rule created.\n\n- **Rule ID**: \`${result.id}\`\n- **Name**: ${name}` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delete Ad Rule ────────────────────────────────────────────────────
  server.registerTool(
    "meta_delete_ad_rule",
    {
      title: "Delete Automated Ad Rule",
      description: `Deletes an automated ad rule.

Args:
  - rule_id (string): Ad rule ID`,
      inputSchema: z
        .object({ rule_id: z.string() })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ rule_id }) => {
      try {
        const result = await client.delete<{ success: boolean }>(`/${rule_id}`);
        return {
          content: [{ type: "text", text: result.success ? `Rule \`${rule_id}\` deleted.` : `Failed to delete rule.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── List Ad Images ────────────────────────────────────────────────────
  server.registerTool(
    "meta_list_ad_images",
    {
      title: "List Ad Images",
      description: `Lists images in an ad account's image library.

Args:
  - ad_account_id (string): Ad account ID
  - limit (number): Max results (default 25)`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          limit: z.number().int().min(1).max(100).default(25),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ad_account_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,hash,name,url,width,height,created_time",
          limit,
        };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<{
          id: string; hash: string; name?: string; url?: string; width?: number; height?: number; created_time?: string;
        }>>(`/${ad_account_id}/adimages`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No ad images found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Ad Images (${data.data.length})`, ""];
        for (const img of data.data) {
          lines.push(`- **${img.name ?? "Unnamed"}** (hash: \`${img.hash}\`)${img.width ? ` — ${img.width}x${img.height}` : ""}${img.created_time ? ` | ${formatDate(img.created_time)}` : ""}`);
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "images") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Browse Targeting Categories ───────────────────────────────────────
  server.registerTool(
    "meta_browse_targeting_categories",
    {
      title: "Browse Targeting Categories",
      description: `Browses all available targeting category types for ad targeting.

Args:
  - type (string): Category type — adTargetingCategory, adcountry, adlocale, adlanguage`,
      inputSchema: z
        .object({
          type: z.enum(["adTargetingCategory", "adcountry", "adlocale"]).default("adTargetingCategory"),
          class: z.enum(["interests", "behaviors", "demographics", "life_events", "industries", "income", "family_statuses", "user_device", "user_os"]).optional().describe("Sub-class filter (for adTargetingCategory)"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ type, class: subclass, response_format }) => {
      try {
        const params: Record<string, unknown> = { type };
        if (subclass) params.class = subclass;

        const data = await client.get<{ data: Array<{ id: string; name: string; type?: string; path?: string[]; audience_size?: number; description?: string }> }>(
          "/search",
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No targeting categories found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
        }

        const lines = [`# Targeting Categories: ${type}${subclass ? ` (${subclass})` : ""} (${data.data.length})`, ""];
        for (const cat of data.data.slice(0, 50)) {
          lines.push(`- **${cat.name}** (\`${cat.id}\`)${cat.path?.length ? ` — ${cat.path.join(" > ")}` : ""}${cat.audience_size ? ` | ~${formatNumber(cat.audience_size)}` : ""}`);
        }
        if (data.data.length > 50) lines.push(`\n_...and ${data.data.length - 50} more_`);
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "categories") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Saved Audience ─────────────────────────────────────────────
  server.registerTool(
    "meta_create_saved_audience",
    {
      title: "Create Saved Audience",
      description: `Creates a saved audience (reusable targeting preset) for an ad account.

Args:
  - ad_account_id (string): Ad account ID
  - name (string): Audience name
  - targeting (object): Targeting spec object`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          name: z.string().min(1),
          targeting: z.record(z.string(), z.unknown()).describe("Targeting specification"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ad_account_id, name, targeting, response_format }) => {
      try {
        const result = await client.post<{ id: string }>(`/${ad_account_id}/saved_audiences`, { name, targeting });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Saved audience created.\n\n- **ID**: \`${result.id}\`\n- **Name**: ${name}` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delete Saved Audience ─────────────────────────────────────────────
  server.registerTool(
    "meta_delete_saved_audience",
    {
      title: "Delete Saved Audience",
      description: `Deletes a saved audience.

Args:
  - audience_id (string): Saved audience ID`,
      inputSchema: z
        .object({ audience_id: z.string() })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ audience_id }) => {
      try {
        const result = await client.delete<{ success: boolean }>(`/${audience_id}`);
        return {
          content: [{ type: "text", text: result.success ? `Saved audience \`${audience_id}\` deleted.` : "Failed to delete." }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── List Business Assets ─────────────────────────────────────────────────
  server.registerTool(
    "meta_list_business_assets",
    {
      title: "List Business Manager Assets",
      description: `Lists assets (pages, ad accounts, Instagram accounts, pixels) for a Business Manager.

Args:
  - business_id: Business Manager ID
  - asset_type: "owned_pages", "owned_ad_accounts", "owned_instagram_accounts", "owned_pixels"
  - limit (optional, default 25): Max results

Returns asset details including IDs, names, and type-specific metadata.`,
      inputSchema: z
        .object({
          business_id: z.string().describe("Business Manager ID"),
          asset_type: z.enum(["owned_pages", "owned_ad_accounts", "owned_instagram_accounts", "owned_pixels"]).describe("Type of assets to list"),
          limit: z.number().int().min(1).max(100).default(25),
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
    async ({ business_id, asset_type, limit, response_format }) => {
      try {
        const fieldsByType: Record<string, string> = {
          owned_pages: "id,name,category,fan_count",
          owned_ad_accounts: "id,name,account_status,currency",
          owned_instagram_accounts: "id,username,name,followers_count",
          owned_pixels: "id,name,creation_time",
        };

        const data = await client.get<MetaPaginatedResponse<Record<string, unknown>>>(
          `/${business_id}/${asset_type}`,
          { fields: fieldsByType[asset_type], limit }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: `No ${asset_type.replace("owned_", "")} found.` }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
        }

        const label = asset_type.replace("owned_", "").replace(/_/g, " ");
        const lines = [`# Business ${label} (${data.data.length})`, ""];
        for (const item of data.data) {
          const name = (item.name ?? item.username ?? "Unnamed") as string;
          lines.push(`## ${name} (\`${item.id}\`)`);
          if (asset_type === "owned_pages") {
            lines.push(`- **Category**: ${item.category ?? "N/A"}`);
            if (item.fan_count != null) lines.push(`- **Fans**: ${formatNumber(item.fan_count as string)}`);
          } else if (asset_type === "owned_ad_accounts") {
            lines.push(`- **Status**: ${item.account_status}`);
            lines.push(`- **Currency**: ${item.currency ?? "N/A"}`);
          } else if (asset_type === "owned_instagram_accounts") {
            if (item.username) lines.push(`- **Username**: @${item.username}`);
            if (item.followers_count != null) lines.push(`- **Followers**: ${formatNumber(item.followers_count as string)}`);
          } else if (asset_type === "owned_pixels") {
            if (item.creation_time) lines.push(`- **Created**: ${formatDate(item.creation_time as string)}`);
          }
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), label) }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
