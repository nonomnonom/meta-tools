import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, formatNumber, formatDate, formatBudget, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { AD_ACCOUNT_FIELDS, CAMPAIGN_FIELDS } from "../../constants.js";
import { AdAccount, Campaign, Ad, MetaPaginatedResponse } from "../../types.js";

export function registerCampaignTools(server: McpServer, client: MetaApiClient): void {
  // ─── List Ad Accounts ─────────────────────────────────────────────────────
  server.registerTool(
    "meta_list_ad_accounts",
    {
      title: "List Meta Ad Accounts",
      description: `Lists all Meta ad accounts accessible to the authenticated user.

Returns ad account IDs (prefixed with act_), names, currency, status, and spend info.

Call this first to get ad account IDs needed for campaign and insights tools.`,
      inputSchema: z
        .object({ response_format: ResponseFormatSchema })
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
        const data = await client.get<MetaPaginatedResponse<AdAccount>>("/me/adaccounts", {
          fields: AD_ACCOUNT_FIELDS,
        });

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No ad accounts found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
        }

        const lines = [`# Meta Ad Accounts (${data.data.length})`, ""];
        for (const acct of data.data) {
          lines.push(`## ${acct.name ?? "Unnamed"} (\`${acct.id}\`)`);
          lines.push(`- **Account ID**: \`${acct.account_id ?? acct.id}\``);
          lines.push(`- **Status**: ${acct.account_status}`);
          lines.push(`- **Currency**: ${acct.currency ?? "N/A"}`);
          lines.push(`- **Timezone**: ${acct.timezone_name ?? "N/A"}`);
          if (acct.amount_spent) lines.push(`- **Total Spent**: ${formatNumber(acct.amount_spent)} ${acct.currency ?? ""} (in cents)`);
          if (acct.balance) lines.push(`- **Balance**: ${formatNumber(acct.balance)} ${acct.currency ?? ""} (in cents)`);
          if (acct.business) lines.push(`- **Business**: ${acct.business.name} (\`${acct.business.id}\`)`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "ad accounts") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── List Campaigns ───────────────────────────────────────────────────────
  server.registerTool(
    "meta_list_campaigns",
    {
      title: "List Campaigns",
      description: `Lists campaigns for a Meta ad account.

Args:
  - ad_account_id (string): Ad account ID (e.g., act_123456789)
  - status_filter (string[], optional): Filter by status: ACTIVE, PAUSED, ARCHIVED, DELETED
  - limit (number): Max results (1–100, default 20)
  - after (string, optional): Pagination cursor

Returns campaign names, objectives, status, and budget info.`,
      inputSchema: z
        .object({
          ad_account_id: z.string().describe("Ad account ID (e.g., act_123456789)"),
          status_filter: z
            .array(z.enum(["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"]))
            .optional()
            .describe("Filter by effective status"),
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
    async ({ ad_account_id, status_filter, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = { fields: CAMPAIGN_FIELDS, limit };
        if (status_filter?.length) params.effective_status = JSON.stringify(status_filter);
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<Campaign>>(
          `/${ad_account_id}/campaigns`,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No campaigns found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Campaigns for \`${ad_account_id}\` (${data.data.length} shown)`, ""];
        for (const c of data.data) {
          lines.push(`## ${c.name} (\`${c.id}\`)`);
          lines.push(`- **Objective**: ${c.objective ?? "N/A"}`);
          lines.push(`- **Status**: ${c.effective_status ?? c.status}`);
          if (c.daily_budget || c.lifetime_budget) {
            lines.push(`- **Budget**: ${formatBudget(c.daily_budget, c.lifetime_budget)}`);
          }
          if (c.budget_remaining) lines.push(`- **Remaining**: ${formatNumber(c.budget_remaining)} cents`);
          if (c.start_time) lines.push(`- **Start**: ${formatDate(c.start_time)}`);
          if (c.stop_time) lines.push(`- **End**: ${formatDate(c.stop_time)}`);
          lines.push(`- **Created**: ${formatDate(c.created_time)}`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "campaigns") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Campaign ─────────────────────────────────────────────────────────
  server.registerTool(
    "meta_get_campaign",
    {
      title: "Get Campaign Details",
      description: `Gets detailed information about a specific campaign.

Args:
  - campaign_id (string): Campaign ID`,
      inputSchema: z
        .object({
          campaign_id: z.string().describe("Campaign ID"),
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
    async ({ campaign_id, response_format }) => {
      try {
        const c = await client.get<Campaign>(`/${campaign_id}`, { fields: CAMPAIGN_FIELDS });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(c, null, 2) }] };
        }

        const lines = [
          `# Campaign: ${c.name}`,
          "",
          `- **ID**: \`${c.id}\``,
          `- **Objective**: ${c.objective ?? "N/A"}`,
          `- **Status**: ${c.effective_status ?? c.status}`,
          c.daily_budget || c.lifetime_budget
            ? `- **Budget**: ${formatBudget(c.daily_budget, c.lifetime_budget)}`
            : "",
          c.budget_remaining ? `- **Remaining**: ${formatNumber(c.budget_remaining)} cents` : "",
          c.start_time ? `- **Start**: ${formatDate(c.start_time)}` : "",
          c.stop_time ? `- **End**: ${formatDate(c.stop_time)}` : "",
          `- **Created**: ${formatDate(c.created_time)}`,
          `- **Updated**: ${formatDate(c.updated_time)}`,
        ]
          .filter(Boolean)
          .join("\n");
        return { content: [{ type: "text", text: lines }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Campaign ──────────────────────────────────────────────────────
  server.registerTool(
    "meta_create_campaign",
    {
      title: "Create Campaign",
      description: `Creates a new campaign in a Meta ad account.

Args:
  - ad_account_id (string): Ad account ID (e.g., act_123456789)
  - name (string): Campaign name
  - objective (string): Campaign objective. Common values:
      OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT,
      OUTCOME_LEADS, OUTCOME_APP_PROMOTION, OUTCOME_SALES
  - status (string): ACTIVE or PAUSED (default PAUSED)
  - daily_budget (number, optional): Daily budget in account currency cents
  - lifetime_budget (number, optional): Lifetime budget in cents (requires stop_time)
  - stop_time (string, optional): ISO 8601 end date (required for lifetime budget)
  - special_ad_categories (string[], optional): Required for housing, employment, credit ads

Note: For OUTCOME_SALES objective, Advantage+ Shopping campaigns are available. These use Meta's AI to optimize targeting and placements automatically. Create a standard campaign first, then use meta_migrate_campaign_to_advantage_plus to convert it.

Returns the new campaign ID.`,
      inputSchema: z
        .object({
          ad_account_id: z.string().describe("Ad account ID (e.g., act_123456789)"),
          name: z.string().min(1).describe("Campaign name"),
          objective: z
            .enum([
              "OUTCOME_AWARENESS",
              "OUTCOME_TRAFFIC",
              "OUTCOME_ENGAGEMENT",
              "OUTCOME_LEADS",
              "OUTCOME_APP_PROMOTION",
              "OUTCOME_SALES",
            ])
            .describe("Campaign objective"),
          status: z.enum(["ACTIVE", "PAUSED"]).default("PAUSED"),
          daily_budget: z.number().int().positive().optional().describe("Daily budget in cents"),
          lifetime_budget: z.number().int().positive().optional().describe("Lifetime budget in cents"),
          stop_time: z.string().optional().describe("End datetime ISO 8601 (required with lifetime_budget)"),
          special_ad_categories: z
            .array(z.enum(["HOUSING", "EMPLOYMENT", "CREDIT", "ISSUES_ELECTIONS_POLITICS", "NONE"]))
            .default(["NONE"])
            .describe("Special ad category compliance"),
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
    async ({ ad_account_id, name, objective, status, daily_budget, lifetime_budget, stop_time, special_ad_categories, response_format }) => {
      try {
        const fields: Record<string, unknown> = {
          name,
          objective,
          status,
          special_ad_categories,
        };
        if (daily_budget) fields.daily_budget = daily_budget;
        if (lifetime_budget) fields.lifetime_budget = lifetime_budget;
        if (stop_time) fields.stop_time = stop_time;

        const result = await client.post<{ id: string }>(
          `/${ad_account_id}/campaigns`,
          fields
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `Campaign created successfully.\n\n- **Campaign ID**: \`${result.id}\`\n- **Name**: ${name}\n- **Objective**: ${objective}\n- **Status**: ${status}`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Update Campaign ──────────────────────────────────────────────────────
  server.registerTool(
    "meta_update_campaign",
    {
      title: "Update Campaign",
      description: `Updates an existing campaign. Only provided fields are changed.

Can also migrate a campaign to Advantage+ Shopping by setting migrate_to_advantage_plus to true.

Args:
  - campaign_id (string): Campaign ID to update
  - name (string, optional): New campaign name
  - status (string, optional): ACTIVE, PAUSED, or ARCHIVED
  - daily_budget (number, optional): New daily budget in cents
  - lifetime_budget (number, optional): New lifetime budget in cents
  - migrate_to_advantage_plus (boolean, optional): Migrate this campaign to Advantage+ Shopping (keeps original campaign ID)`,
      inputSchema: z
        .object({
          campaign_id: z.string().describe("Campaign ID"),
          name: z.string().optional(),
          status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
          daily_budget: z.number().int().positive().optional(),
          lifetime_budget: z.number().int().positive().optional(),
          migrate_to_advantage_plus: z.boolean().optional().describe("Migrate this campaign to Advantage+ Shopping (keeps original campaign ID)"),
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
    async ({ campaign_id, name, status, daily_budget, lifetime_budget, migrate_to_advantage_plus, response_format }) => {
      try {
        const fields: Record<string, unknown> = {};
        if (name) fields.name = name;
        if (status) fields.status = status;
        if (daily_budget) fields.daily_budget = daily_budget;
        if (lifetime_budget) fields.lifetime_budget = lifetime_budget;
        if (migrate_to_advantage_plus !== undefined) fields.migrate_to_advantage_plus = migrate_to_advantage_plus;

        const result = await client.post<{ success: boolean }>(`/${campaign_id}`, fields);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `Campaign \`${campaign_id}\` updated successfully.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delete Campaign ──────────────────────────────────────────────────────
  server.registerTool(
    "meta_delete_campaign",
    {
      title: "Delete Campaign",
      description: `Deletes (archives) a campaign. This cannot be undone.

Args:
  - campaign_id (string): Campaign ID to delete`,
      inputSchema: z
        .object({
          campaign_id: z.string().describe("Campaign ID"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ campaign_id }) => {
      try {
        const result = await client.delete<{ success: boolean }>(`/${campaign_id}`);
        return {
          content: [
            {
              type: "text",
              text: result.success
                ? `Campaign \`${campaign_id}\` deleted successfully.`
                : `Failed to delete campaign \`${campaign_id}\`.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Migrate Campaign to Advantage+ ──────────────────────────────────────
  server.registerTool(
    "meta_migrate_campaign_to_advantage_plus",
    {
      title: "Migrate Campaign to Advantage+",
      description: `Migrates an existing campaign to Advantage+ Shopping (formerly ASC).

Advantage+ Shopping campaigns use Meta's AI to automatically optimize targeting, placements, and creative delivery for online sales. After migration, Meta handles audience selection and budget allocation across placements for better ROAS.

The campaign keeps its original ID — this is an in-place conversion, not a new campaign.

Args:
  - campaign_id (string): Campaign ID to migrate
  - ad_account_id (string): Ad account ID (e.g., act_123456789)`,
      inputSchema: z
        .object({
          campaign_id: z.string().describe("Campaign ID to migrate"),
          ad_account_id: z.string().describe("Ad account ID (e.g., act_123456789)"),
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
    async ({ campaign_id, ad_account_id, response_format }) => {
      try {
        const result = await client.post<{ success: boolean }>(`/${campaign_id}`, {
          migrate_to_advantage_plus: true,
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify({ success: true, campaign_id, ad_account_id }, null, 2) }] };
        }

        return {
          content: [
            {
              type: "text",
              text: `Campaign \`${campaign_id}\` migrated to Advantage+ Shopping successfully.\n\n- **Campaign ID**: \`${campaign_id}\` (unchanged)\n- **Ad Account**: \`${ad_account_id}\`\n\nThe campaign now uses Meta's AI for automated targeting, placements, and creative optimization.`,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
