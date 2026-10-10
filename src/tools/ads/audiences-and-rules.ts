import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, formatNumber, formatDate, ResponseFormatSchema } from "../../services/utils.js";
import { Ad, MetaPaginatedResponse } from "../../types.js";

export function registerSavedAudienceTools(server: McpServer, client: MetaApiClient): void {
  // ─── List Saved Audiences ──────────────────────────────────────────────
  server.registerTool(
    "meta_list_saved_audiences",
    {
      title: "List Saved Audiences",
      description: `Lists saved audiences (targeting presets) for an ad account.

Args:
  - ad_account_id (string): Ad account ID`,
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
          fields: "id,name,targeting,approximate_count_lower_bound,approximate_count_upper_bound",
          limit,
        };
        if (after) params.after = after;

        const data = await client.get<MetaPaginatedResponse<{
          id: string; name: string; approximate_count_lower_bound?: number; approximate_count_upper_bound?: number; targeting?: Record<string, unknown>;
        }>>(`/${ad_account_id}/saved_audiences`, params);

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No saved audiences found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Saved Audiences (${data.data.length})`, ""];
        for (const aud of data.data) {
          lines.push(`- **${aud.name}** (\`${aud.id}\`)${aud.approximate_count_lower_bound != null && aud.approximate_count_upper_bound != null ? ` — ~${formatNumber(aud.approximate_count_lower_bound)}–${formatNumber(aud.approximate_count_upper_bound)} people` : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── List Ad Rules ─────────────────────────────────────────────────────
  server.registerTool(
    "meta_list_ad_rules",
    {
      title: "List Automated Ad Rules",
      description: `Lists automated rules for an ad account.

Args:
  - ad_account_id (string): Ad account ID`,
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
        const data = await client.get<MetaPaginatedResponse<{
          id: string; name: string; status: string; evaluation_spec?: Record<string, unknown>; execution_spec?: Record<string, unknown>;
        }>>(`/${ad_account_id}/adrules_library`, {
          fields: "id,name,status,evaluation_spec,execution_spec",
        });

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No ad rules found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Automated Ad Rules (${data.data.length})`, ""];
        for (const rule of data.data) {
          lines.push(`- **${rule.name}** (\`${rule.id}\`) — Status: ${rule.status}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── List Ad Labels ────────────────────────────────────────────────────
  server.registerTool(
    "meta_list_ad_labels",
    {
      title: "List Ad Labels",
      description: `Lists ad labels for an ad account. Labels help organize campaigns, ad sets, and ads.

Args:
  - ad_account_id (string): Ad account ID`,
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
        const data = await client.get<MetaPaginatedResponse<{
          id: string; name: string; created_time?: string;
        }>>(`/${ad_account_id}/adlabels`, {
          fields: "id,name,created_time",
        });

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No ad labels found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Ad Labels (${data.data.length})`, ""];
        for (const label of data.data) {
          lines.push(`- **${label.name}** (\`${label.id}\`)${label.created_time ? ` — Created: ${formatDate(label.created_time)}` : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Ad Label ───────────────────────────────────────────────────
  server.registerTool(
    "meta_create_ad_label",
    {
      title: "Create Ad Label",
      description: `Creates a label for organizing ads, ad sets, or campaigns.

Args:
  - ad_account_id (string): Ad account ID
  - name (string): Label name`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          name: z.string().min(1),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ad_account_id, name, response_format }) => {
      try {
        const result = await client.post<{ id: string }>(`/${ad_account_id}/adlabels`, { name });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Label created.\n\n- **ID**: \`${result.id}\`\n- **Name**: ${name}` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
