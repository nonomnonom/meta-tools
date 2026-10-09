import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, truncateField, formatNumber, formatDate, buildPaginationNote, ResponseFormatSchema } from "../../services/utils.js";
import { Campaign, Ad, MetaPaginatedResponse } from "../../types.js";

export function registerStudyAndLeadTools(server: McpServer, client: MetaApiClient): void {
  // ─── Create A/B Test (Ad Study) ───────────────────────────────────────────
  server.registerTool(
    "meta_create_ad_study",
    {
      title: "Create A/B Test (Ad Study)",
      description: `Creates an A/B test (ad study) to compare campaigns or ad sets.

Args:
  - ad_account_id (string): Ad account ID (e.g., act_123456789)
  - name (string): Study name
  - description (string, optional): Study description
  - start_time (string): ISO 8601 start time
  - end_time (string): ISO 8601 end time
  - type (enum): SPLIT_TEST or HOLDOUT
  - cells (array): Test cells, each with name, treatment_percentage, and optional campaign_ids/adset_ids
  - confidence_level (number, default 95): Statistical confidence level (e.g., 90, 95, 99)

Returns: The created study ID.`,
      inputSchema: z
        .object({
          ad_account_id: z.string().describe("Ad account ID (e.g., act_123456789)"),
          name: z.string().min(1).describe("Study name"),
          description: z.string().optional().describe("Study description"),
          start_time: z.string().describe("ISO 8601 start time"),
          end_time: z.string().describe("ISO 8601 end time"),
          type: z.enum(["SPLIT_TEST", "HOLDOUT"]).describe("Study type"),
          cells: z
            .array(
              z.object({
                name: z.string().describe("Cell name"),
                treatment_percentage: z.number().min(1).max(100).describe("Traffic percentage for this cell"),
                campaign_ids: z.array(z.string()).optional().describe("Campaign IDs in this cell"),
                adset_ids: z.array(z.string()).optional().describe("Ad set IDs in this cell"),
              })
            )
            .min(2)
            .describe("Test cells (minimum 2)"),
          confidence_level: z.number().default(95).describe("Statistical confidence level"),
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
    async ({ ad_account_id, name, description, start_time, end_time, type, cells, confidence_level, response_format }) => {
      try {
        const payload: Record<string, unknown> = {
          name,
          start_time,
          end_time,
          type,
          cells: cells.map((cell) => {
            const c: Record<string, unknown> = {
              name: cell.name,
              treatment_percentage: cell.treatment_percentage,
            };
            if (cell.campaign_ids?.length) c.campaigns = cell.campaign_ids;
            if (cell.adset_ids?.length) c.adsets = cell.adset_ids;
            return c;
          }),
          confidence_level,
        };
        if (description) payload.description = description;

        const result = await client.post<{ id: string }>(
          `/${ad_account_id}/ad_studies`,
          payload
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `A/B test created successfully.\n\n- **Study ID**: \`${result.id}\`\n- **Name**: ${name}\n- **Type**: ${type}\n- **Cells**: ${cells.length}`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── List A/B Tests (Ad Studies) ──────────────────────────────────────────
  server.registerTool(
    "meta_get_ad_studies",
    {
      title: "List A/B Tests (Ad Studies)",
      description: `Lists A/B tests (ad studies) for a Meta ad account.

Args:
  - ad_account_id (string): Ad account ID (e.g., act_123456789)
  - limit (number): Max results (1–50, default 10)

Returns: List of studies with name, type, status, dates, and results.`,
      inputSchema: z
        .object({
          ad_account_id: z.string().describe("Ad account ID (e.g., act_123456789)"),
          limit: z.number().int().min(1).max(50).default(10),
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
    async ({ ad_account_id, limit, response_format }) => {
      try {
        const data = await client.get<MetaPaginatedResponse<Record<string, unknown>>>(
          `/${ad_account_id}/ad_studies`,
          {
            fields: "id,name,description,start_time,end_time,type,results,cells",
            limit,
          }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No A/B tests found for this ad account." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
        }

        const lines = [`# A/B Tests (${data.data.length})`, ""];
        for (const study of data.data) {
          lines.push(`## ${study.name ?? "Unnamed"} (\`${study.id}\`)`);
          if (study.type) lines.push(`- **Type**: ${study.type}`);
          if (study.description) lines.push(`- **Description**: ${truncateField(study.description as string, 200)}`);
          if (study.start_time) lines.push(`- **Start**: ${formatDate(study.start_time as string)}`);
          if (study.end_time) lines.push(`- **End**: ${formatDate(study.end_time as string)}`);
          if (study.cells && Array.isArray(study.cells)) {
            lines.push(`- **Cells**: ${(study.cells as Array<Record<string, unknown>>).length}`);
          }
          if (study.results) lines.push(`- **Results**: ${JSON.stringify(study.results)}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "A/B tests") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get A/B Test Results ─────────────────────────────────────────────────
  server.registerTool(
    "meta_get_ad_study_results",
    {
      title: "Get A/B Test Results",
      description: `Gets detailed results of a specific A/B test (ad study).

Args:
  - study_id (string): The ad study ID

Returns: Study details including winner, confidence level, and per-cell metrics.`,
      inputSchema: z
        .object({
          study_id: z.string().describe("Ad study ID"),
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
    async ({ study_id, response_format }) => {
      try {
        const data = await client.get<Record<string, unknown>>(
          `/${study_id}`,
          {
            fields: "id,name,type,start_time,end_time,results,cells,confidence_level",
          }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `# A/B Test Results: ${data.name ?? study_id}`,
          "",
        ];
        if (data.type) lines.push(`- **Type**: ${data.type}`);
        if (data.confidence_level) lines.push(`- **Confidence Level**: ${data.confidence_level}%`);
        if (data.start_time) lines.push(`- **Start**: ${formatDate(data.start_time as string)}`);
        if (data.end_time) lines.push(`- **End**: ${formatDate(data.end_time as string)}`);
        lines.push("");

        if (data.results) {
          lines.push(`## Results`);
          const results = data.results as Record<string, unknown>;
          if (results.winner) lines.push(`- **Winner**: ${JSON.stringify(results.winner)}`);
          lines.push(`- **Raw**: ${JSON.stringify(results)}`);
          lines.push("");
        }

        if (data.cells && Array.isArray(data.cells)) {
          lines.push(`## Cells`);
          for (const cell of data.cells as Array<Record<string, unknown>>) {
            lines.push(`### ${cell.name ?? "Unnamed Cell"}`);
            if (cell.treatment_percentage != null) lines.push(`- **Traffic**: ${cell.treatment_percentage}%`);
            if (cell.campaigns) lines.push(`- **Campaigns**: ${JSON.stringify(cell.campaigns)}`);
            if (cell.adsets) lines.push(`- **Ad Sets**: ${JSON.stringify(cell.adsets)}`);
            lines.push("");
          }
        }

        return { content: [{ type: "text", text: truncate(lines.join("\n"), "A/B test results") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── List Lead Gen Forms ──────────────────────────────────────────────
  server.registerTool(
    "meta_list_leadgen_forms",
    {
      title: "List Lead Gen Forms",
      description: `Lists lead generation forms for a Facebook Page.

Lead forms are used with OUTCOME_LEADS campaigns to collect user information.

Requires: meta_list_pages must be called first to load page tokens.

Args:
  - page_id (string): Facebook Page ID
  - limit (number): Max results (1–100, default 20)

Returns form IDs, names, status, and creation times.`,
      inputSchema: z
        .object({
          page_id: z.string().describe("Facebook Page ID"),
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
          fields: "id,name,status,created_time,leads_count,locale,questions",
          limit,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string;
          name: string;
          status: string;
          created_time?: string;
          leads_count?: number;
          locale?: string;
          questions?: Array<{ key: string; label: string; type: string }>;
        }>>(`/${page_id}/leadgen_forms`, pageToken, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No lead gen forms found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Lead Gen Forms (${data.data.length})`, ""];
        for (const form of data.data) {
          lines.push(`## ${form.name} (\`${form.id}\`)`);
          lines.push(`- **Status**: ${form.status}`);
          if (form.leads_count !== undefined) lines.push(`- **Leads**: ${formatNumber(form.leads_count)}`);
          if (form.locale) lines.push(`- **Locale**: ${form.locale}`);
          if (form.created_time) lines.push(`- **Created**: ${formatDate(form.created_time)}`);
          if (form.questions?.length) {
            lines.push(`- **Questions**: ${form.questions.map(q => q.label || q.key).join(", ")}`);
          }
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "lead gen forms") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Lead Gen Form Leads ────────────────────────────────────────────
  server.registerTool(
    "meta_get_leadgen_leads",
    {
      title: "Get Leads from Form",
      description: `Gets submitted leads from a lead generation form.

Requires: meta_list_pages must be called first to load page tokens.

Args:
  - form_id (string): Lead gen form ID (from meta_list_leadgen_forms)
  - page_id (string): Page ID (for authentication)
  - limit (number): Max results (1–100, default 25)
  - after (string, optional): Pagination cursor

Returns lead data including field values, creation time, and ad info.`,
      inputSchema: z
        .object({
          form_id: z.string().describe("Lead gen form ID"),
          page_id: z.string().describe("Page ID (for token)"),
          limit: z.number().int().min(1).max(100).default(25),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ form_id, page_id, limit, after, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const params: Record<string, unknown> = {
          fields: "id,created_time,field_data,ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name",
          limit,
        };
        if (after) params.after = after;

        const data = await client.getWithToken<MetaPaginatedResponse<{
          id: string;
          created_time: string;
          field_data: Array<{ name: string; values: string[] }>;
          ad_id?: string;
          ad_name?: string;
          campaign_id?: string;
          campaign_name?: string;
          adset_id?: string;
          adset_name?: string;
        }>>(`/${form_id}/leads`, pageToken, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No leads found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const nextCursor = data.paging?.cursors?.after;
        const lines = [`# Leads (${data.data.length})`, ""];
        for (const lead of data.data) {
          lines.push(`## Lead \`${lead.id}\` (${formatDate(lead.created_time)})`);
          for (const field of lead.field_data) {
            lines.push(`- **${field.name}**: ${field.values.join(", ")}`);
          }
          if (lead.campaign_name) lines.push(`- _Campaign: ${lead.campaign_name}_`);
          if (lead.ad_name) lines.push(`- _Ad: ${lead.ad_name}_`);
          lines.push("");
        }
        if (nextCursor) lines.push(buildPaginationNote(data.data.length, nextCursor));
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "leads") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Ad Rule ─────────────────────────────────────────────────────────
  server.registerTool(
    "meta_get_ad_rule",
    {
      title: "Get Ad Rule Details",
      description: `Gets details for a specific automated ad rule.

Args:
  - rule_id (string): Ad rule ID`,
      inputSchema: z
        .object({
          rule_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ rule_id, response_format }) => {
      try {
        const data = await client.get<{
          id: string;
          name: string;
          status: string;
          evaluation_spec?: Record<string, unknown>;
          execution_spec?: Record<string, unknown>;
          schedule_spec?: Record<string, unknown>;
          created_time?: string;
          updated_time?: string;
        }>(`/${rule_id}`, {
          fields: "id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time,updated_time",
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `# Rule: ${data.name}`,
          "",
          `- **ID**: \`${data.id}\``,
          `- **Status**: ${data.status}`,
          data.evaluation_spec ? `- **Evaluation**: ${JSON.stringify(data.evaluation_spec, null, 2)}` : "",
          data.execution_spec ? `- **Action**: ${JSON.stringify(data.execution_spec, null, 2)}` : "",
          data.schedule_spec ? `- **Schedule**: ${JSON.stringify(data.schedule_spec, null, 2)}` : "",
          data.created_time ? `- **Created**: ${formatDate(data.created_time)}` : "",
          data.updated_time ? `- **Updated**: ${formatDate(data.updated_time)}` : "",
        ].filter(Boolean);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Minimum Budgets ──────────────────────────────────────────────
  server.registerTool(
    "meta_get_minimum_budgets",
    {
      title: "Get Minimum Ad Budgets",
      description: `Gets the minimum daily and lifetime budgets for an ad account by currency and bid strategy.

Essential to check before creating ad sets — using a budget below the minimum causes API errors.

Args:
  - ad_account_id (string): Ad account ID (e.g., act_123456789)

Returns: Minimum budget requirements per bid strategy.`,
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
        const data = await client.get<{ data: Array<{
          currency: string;
          min_daily_budget_imp: number;
          min_daily_budget_low_freq: number;
          min_daily_budget_high_freq: number;
        }> }>(`/${ad_account_id}/minimum_budgets`, {});

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No minimum budget data available." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Minimum Budgets for \`${ad_account_id}\``, ""];
        for (const row of data.data) {
          lines.push(`## ${row.currency}`);
          lines.push(`- **Impressions**: ${formatNumber(row.min_daily_budget_imp)} cents/day`);
          lines.push(`- **Low Frequency Events**: ${formatNumber(row.min_daily_budget_low_freq)} cents/day`);
          lines.push(`- **High Frequency Events**: ${formatNumber(row.min_daily_budget_high_freq)} cents/day`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── List Offline Event Sets ──────────────────────────────────────────
  server.registerTool(
    "meta_list_offline_event_sets",
    {
      title: "List Offline Event Sets",
      description: `Lists offline conversion event sets for an ad account.

Offline event sets track conversions that happen outside of digital channels (in-store purchases, phone orders, etc.).

Args:
  - ad_account_id (string): Ad account ID (e.g., act_123456789)
  - limit (number): Max results (1–100, default 25)
  - after (string, optional): Pagination cursor

Returns: Event set IDs, names, and configuration.`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          limit: z.number().int().min(1).max(100).default(25),
          after: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ ad_account_id, limit, after, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,name,description,is_auto_assigned,event_stats,last_fired_time",
          limit,
        };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<{
          id: string;
          name: string;
          description?: string;
          is_auto_assigned?: boolean;
          event_stats?: string;
          last_fired_time?: string;
        }>>(`/${ad_account_id}/offline_conversion_data_sets`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No offline event sets found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Offline Event Sets (${data.data.length})`, ""];
        for (const es of data.data) {
          lines.push(`## ${es.name} (\`${es.id}\`)`);
          if (es.description) lines.push(`- **Description**: ${es.description}`);
          if (es.last_fired_time) lines.push(`- **Last Event**: ${formatDate(es.last_fired_time)}`);
          if (es.is_auto_assigned !== undefined) lines.push(`- **Auto-assigned**: ${es.is_auto_assigned}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Send Offline Conversion Event ───────────────────────────────────
  server.registerTool(
    "meta_send_offline_event",
    {
      title: "Send Offline Conversion Event",
      description: `Sends an offline conversion event to a Meta offline event set.

Used for tracking in-store purchases, phone orders, or other offline conversions.

Args:
  - event_set_id (string): Offline event set ID (from meta_list_offline_event_sets)
  - event_name (string): Event name (e.g., "Purchase", "Lead")
  - event_time (number): Unix timestamp of the conversion
  - user_data (object): Customer match data — at least one of: email, phone, fn (first name), ln (last name), ct (city), st (state), zip, country, external_id. All PII must be SHA256 hashed.
  - custom_data (object, optional): { currency, value, content_name, order_id }
  - upload_tag (string, optional): Tag for grouping uploads

Returns: Number of events received.`,
      inputSchema: z
        .object({
          event_set_id: z.string().describe("Offline event set ID"),
          event_name: z.string().describe("Event name (e.g., 'Purchase')"),
          event_time: z.number().describe("Unix timestamp"),
          user_data: z.record(z.string()).describe("Customer match data (hashed PII)"),
          custom_data: z.object({
            currency: z.string().optional(),
            value: z.number().optional(),
            content_name: z.string().optional(),
            order_id: z.string().optional(),
          }).optional(),
          upload_tag: z.string().optional().describe("Tag for grouping uploads"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ event_set_id, event_name, event_time, user_data, custom_data, upload_tag, response_format }) => {
      try {
        const event: Record<string, unknown> = {
          match_keys: user_data,
          event_name,
          event_time,
        };
        if (custom_data?.currency) event.currency = custom_data.currency;
        if (custom_data?.value !== undefined) event.value = custom_data.value;
        if (custom_data?.content_name) event.content_name = custom_data.content_name;
        if (custom_data?.order_id) event.order_id = custom_data.order_id;

        const payload: Record<string, unknown> = {
          data: [event],
        };
        if (upload_tag) payload.upload_tag = upload_tag;

        const result = await client.post<{ num_processed_entries: number; entries_processed?: number }>(
          `/${event_set_id}/events`,
          payload
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return {
          content: [{
            type: "text",
            text: `Offline event sent.\n\n- **Events Processed**: ${result.num_processed_entries ?? result.entries_processed ?? "unknown"}\n- **Event Name**: ${event_name}\n- **Event Set**: \`${event_set_id}\``,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
