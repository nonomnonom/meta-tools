import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, formatDate, formatBudget, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { ADSET_FIELDS, AD_FIELDS } from "../../constants.js";
import { Campaign, AdSet, Ad, MetaPaginatedResponse } from "../../types.js";

export function registerAdDeliveryTools(server: McpServer, client: MetaApiClient): void {
  // ─── List Ad Sets ─────────────────────────────────────────────────────────
  server.registerTool(
    "meta_list_adsets",
    {
      title: "List Ad Sets",
      description: `Lists ad sets for a campaign or ad account.

Args:
  - campaign_id (string, optional): Filter by campaign ID
  - ad_account_id (string, optional): Ad account ID (use if not filtering by campaign)
  - status_filter (string[], optional): ACTIVE, PAUSED, ARCHIVED, DELETED
  - limit (number): Max results (default 20)
  - after (string, optional): Pagination cursor

Provide either campaign_id or ad_account_id.`,
      inputSchema: z
        .object({
          campaign_id: z.string().optional().describe("Filter by campaign ID"),
          ad_account_id: z.string().optional().describe("Ad account ID (if no campaign filter)"),
          status_filter: z
            .array(z.enum(["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"]))
            .optional(),
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
    async ({ campaign_id, ad_account_id, status_filter, limit, after, response_format }) => {
      try {
        const parentId = campaign_id ?? ad_account_id;
        if (!parentId) {
          return {
            content: [{ type: "text", text: "Error: Provide either campaign_id or ad_account_id." }], isError: true,
          };
        }

        const params: Record<string, unknown> = { fields: ADSET_FIELDS, limit };
        if (status_filter?.length) params.effective_status = JSON.stringify(status_filter);
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<AdSet>>(
          `/${parentId}/adsets`,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No ad sets found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Ad Sets (${data.data.length} shown)`, ""];
        for (const s of data.data) {
          lines.push(`## ${s.name} (\`${s.id}\`)`);
          lines.push(`- **Campaign**: \`${s.campaign_id}\``);
          lines.push(`- **Status**: ${s.effective_status ?? s.status}`);
          lines.push(`- **Budget**: ${formatBudget(s.daily_budget, s.lifetime_budget)}`);
          lines.push(`- **Optimization Goal**: ${s.optimization_goal ?? "N/A"}`);
          lines.push(`- **Billing Event**: ${s.billing_event ?? "N/A"}`);
          if (s.start_time) lines.push(`- **Start**: ${formatDate(s.start_time)}`);
          if (s.end_time) lines.push(`- **End**: ${formatDate(s.end_time)}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "ad sets") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Ad Set ─────────────────────────────────────────────────────────
  server.registerTool(
    "meta_create_adset",
    {
      title: "Create Ad Set",
      description: `Creates a new ad set within a campaign.

Args:
  - ad_account_id (string): Ad account ID (e.g., act_123456789)
  - campaign_id (string): Parent campaign ID
  - name (string): Ad set name
  - daily_budget (number, optional): Daily budget in cents
  - lifetime_budget (number, optional): Lifetime budget in cents (requires end_time)
  - billing_event (string): How you're charged: IMPRESSIONS, LINK_CLICKS, etc.
  - optimization_goal (string): What to optimize for: REACH, LINK_CLICKS, CONVERSIONS, etc.
  - targeting (object): Targeting spec JSON. Example: {"geo_locations": {"countries": ["US"]}, "age_min": 18, "age_max": 65}
  - start_time (string, optional): ISO 8601 start time
  - end_time (string, optional): ISO 8601 end time (required with lifetime_budget)
  - status (string): ACTIVE or PAUSED (default PAUSED)
  - placement_soft_opt_out (string[], optional): Placements to soft opt-out (up to 5% spend may still go to these). Only for Sales/Leads objectives.

Returns the new ad set ID.`,
      inputSchema: z
        .object({
          ad_account_id: z.string().describe("Ad account ID"),
          campaign_id: z.string().describe("Parent campaign ID"),
          name: z.string().min(1),
          daily_budget: z.number().int().positive().optional(),
          lifetime_budget: z.number().int().positive().optional(),
          billing_event: z
            .enum(["IMPRESSIONS", "LINK_CLICKS", "POST_ENGAGEMENT", "PAGE_LIKES", "APP_INSTALLS", "VIDEO_VIEWS"])
            .describe("Billing event type"),
          optimization_goal: z
            .enum([
              "REACH",
              "LINK_CLICKS",
              "CONVERSIONS",
              "LANDING_PAGE_VIEWS",
              "APP_INSTALLS",
              "VIDEO_VIEWS",
              "LEAD_GENERATION",
              "ENGAGED_USERS",
              "PAGE_LIKES",
            ])
            .describe("Optimization goal"),
          targeting: z
            .record(z.unknown())
            .describe("Targeting spec object (geo_locations, age, interests, etc.)"),
          start_time: z.string().optional(),
          end_time: z.string().optional(),
          status: z.enum(["ACTIVE", "PAUSED"]).default("PAUSED"),
          placement_soft_opt_out: z.array(z.string()).optional().describe("Placements to soft opt-out (up to 5% spend may still go to these for better performance). Only for Sales/Leads objectives."),
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
    async ({ ad_account_id, campaign_id, name, daily_budget, lifetime_budget, billing_event, optimization_goal, targeting, start_time, end_time, status, placement_soft_opt_out, response_format }) => {
      try {
        const fields: Record<string, unknown> = {
          campaign_id,
          name,
          billing_event,
          optimization_goal,
          targeting,
          status,
        };
        if (daily_budget) fields.daily_budget = daily_budget;
        if (lifetime_budget) fields.lifetime_budget = lifetime_budget;
        if (start_time) fields.start_time = start_time;
        if (end_time) fields.end_time = end_time;
        if (placement_soft_opt_out) fields.placement_soft_opt_out = placement_soft_opt_out;

        const result = await client.post<{ id: string }>(
          `/${ad_account_id}/adsets`,
          fields
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `Ad set created successfully.\n\n- **Ad Set ID**: \`${result.id}\`\n- **Name**: ${name}\n- **Status**: ${status}`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Update Ad Set ────────────────────────────────────────────────────────
  server.registerTool(
    "meta_update_adset",
    {
      title: "Update Ad Set",
      description: `Updates an existing ad set. Only provided fields are changed.

Args:
  - adset_id (string): Ad set ID to update
  - name (string, optional): New name
  - status (string, optional): ACTIVE, PAUSED, or ARCHIVED
  - daily_budget (number, optional): New daily budget in cents
  - end_time (string, optional): New end time ISO 8601
  - placement_soft_opt_out (string[], optional): Placements to soft opt-out (up to 5% spend may still go to these). Only for Sales/Leads objectives.`,
      inputSchema: z
        .object({
          adset_id: z.string(),
          name: z.string().optional(),
          status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
          daily_budget: z.number().int().positive().optional(),
          end_time: z.string().optional(),
          placement_soft_opt_out: z.array(z.string()).optional().describe("Placements to soft opt-out (up to 5% spend may still go to these for better performance). Only for Sales/Leads objectives."),
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
    async ({ adset_id, name, status, daily_budget, end_time, placement_soft_opt_out, response_format }) => {
      try {
        const fields: Record<string, unknown> = {};
        if (name) fields.name = name;
        if (status) fields.status = status;
        if (daily_budget) fields.daily_budget = daily_budget;
        if (end_time) fields.end_time = end_time;
        if (placement_soft_opt_out) fields.placement_soft_opt_out = placement_soft_opt_out;

        await client.post(`/${adset_id}`, fields);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify({ success: true, id: adset_id }, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Ad set \`${adset_id}\` updated successfully.` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── List Ads ─────────────────────────────────────────────────────────────
  server.registerTool(
    "meta_list_ads",
    {
      title: "List Ads",
      description: `Lists ads for an ad set, campaign, or ad account.

Args:
  - adset_id (string, optional): Filter by ad set
  - campaign_id (string, optional): Filter by campaign
  - ad_account_id (string, optional): List all ads in account
  - status_filter (string[], optional): ACTIVE, PAUSED, ARCHIVED, DELETED
  - limit (number): Max results (default 20)
  - after (string, optional): Pagination cursor

Provide one of adset_id, campaign_id, or ad_account_id.`,
      inputSchema: z
        .object({
          adset_id: z.string().optional(),
          campaign_id: z.string().optional(),
          ad_account_id: z.string().optional(),
          status_filter: z
            .array(z.enum(["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"]))
            .optional(),
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
    async ({ adset_id, campaign_id, ad_account_id, status_filter, limit, after, response_format }) => {
      try {
        const parentId = adset_id ?? campaign_id ?? ad_account_id;
        if (!parentId) {
          return {
            content: [{ type: "text", text: "Error: Provide adset_id, campaign_id, or ad_account_id." }], isError: true,
          };
        }

        const params: Record<string, unknown> = { fields: AD_FIELDS, limit };
        if (status_filter?.length) params.effective_status = JSON.stringify(status_filter);
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<Ad>>(`/${parentId}/ads`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No ads found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Ads (${data.data.length} shown)`, ""];
        for (const ad of data.data) {
          lines.push(`## ${ad.name} (\`${ad.id}\`)`);
          lines.push(`- **Ad Set**: \`${ad.adset_id}\``);
          lines.push(`- **Campaign**: \`${ad.campaign_id}\``);
          lines.push(`- **Status**: ${ad.effective_status ?? ad.status}`);
          if (ad.creative) lines.push(`- **Creative ID**: \`${ad.creative.id}\``);
          if (ad.preview_shareable_link) lines.push(`- **Preview**: ${ad.preview_shareable_link}`);
          lines.push(`- **Created**: ${formatDate(ad.created_time)}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "ads") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Ad ─────────────────────────────────────────────────────────────
  server.registerTool(
    "meta_create_ad",
    {
      title: "Create Ad",
      description: `Creates a new ad within an ad set.

Args:
  - ad_account_id (string): Ad account ID
  - adset_id (string): Parent ad set ID
  - name (string): Ad name
  - creative_id (string): Ad creative ID (from meta_list_ad_creatives or meta_create_ad_creative)
  - status (string): ACTIVE or PAUSED (default PAUSED)

Returns the new ad ID.`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          adset_id: z.string(),
          name: z.string().min(1),
          creative_id: z.string().describe("Ad creative ID"),
          status: z.enum(["ACTIVE", "PAUSED"]).default("PAUSED"),
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
    async ({ ad_account_id, adset_id, name, creative_id, status, response_format }) => {
      try {
        const result = await client.post<{ id: string }>(`/${ad_account_id}/ads`, {
          adset_id,
          name,
          creative: { creative_id },
          status,
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `Ad created successfully.\n\n- **Ad ID**: \`${result.id}\`\n- **Name**: ${name}\n- **Status**: ${status}`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Update Ad ────────────────────────────────────────────────────────────
  server.registerTool(
    "meta_update_ad",
    {
      title: "Update Ad",
      description: `Updates an existing ad's status or name.

Args:
  - ad_id (string): Ad ID
  - name (string, optional): New name
  - status (string, optional): ACTIVE, PAUSED, or ARCHIVED`,
      inputSchema: z
        .object({
          ad_id: z.string(),
          name: z.string().optional(),
          status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
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
    async ({ ad_id, name, status, response_format }) => {
      try {
        const fields: Record<string, unknown> = {};
        if (name) fields.name = name;
        if (status) fields.status = status;

        await client.post(`/${ad_id}`, fields);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify({ success: true, id: ad_id }, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Ad \`${ad_id}\` updated successfully.` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
