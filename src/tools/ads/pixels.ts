import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncateField, formatDate, ResponseFormatSchema } from "../../services/utils.js";
import { Ad, MetaPaginatedResponse } from "../../types.js";

export function registerPixelTools(server: McpServer, client: MetaApiClient): void {
  // ─── List Ad Account Pixels ────────────────────────────────────────────
  server.registerTool(
    "meta_list_pixels",
    {
      title: "List Ad Account Pixels",
      description: `Lists all Meta Pixels for an ad account.

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
          id: string; name: string; last_fired_time?: string; is_unavailable?: boolean; creation_time?: string;
        }>>(`/${ad_account_id}/adspixels`, {
          fields: "id,name,last_fired_time,is_unavailable,creation_time",
        });

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No pixels found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Meta Pixels (${data.data.length})`, ""];
        for (const px of data.data) {
          lines.push(`## ${px.name} (\`${px.id}\`)`);
          if (px.last_fired_time) lines.push(`- **Last fired**: ${formatDate(px.last_fired_time)}`);
          if (px.creation_time) lines.push(`- **Created**: ${formatDate(px.creation_time)}`);
          lines.push(`- **Status**: ${px.is_unavailable ? "Unavailable" : "Active"}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Pixel ──────────────────────────────────────────────────────
  server.registerTool(
    "meta_create_pixel",
    {
      title: "Create Meta Pixel",
      description: `Creates a new Meta Pixel for conversion tracking.

Args:
  - ad_account_id (string): Ad account ID
  - name (string): Pixel name`,
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
        const result = await client.post<{ id: string }>(`/${ad_account_id}/adspixels`, { name });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Pixel created.\n\n- **Pixel ID**: \`${result.id}\`\n- **Name**: ${name}` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Pixel Details ──────────────────────────────────────────────────
  server.registerTool(
    "meta_get_pixel",
    {
      title: "Get Meta Pixel Details",
      description: `Gets details for a single Meta Pixel.

Args:
  - pixel_id (string): Pixel ID
  - response_format (optional): "json" or "text"`,
      inputSchema: z
        .object({
          pixel_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ pixel_id, response_format }) => {
      try {
        const data = await client.get<{
          id: string; name: string; code?: string; creation_time?: string;
          is_created_by_business?: boolean; first_party_cookie_status?: string;
          automatic_matching_fields?: string[]; data_use_setting?: string; last_fired_time?: string;
        }>(`/${pixel_id}`, {
          fields: "id,name,code,creation_time,is_created_by_business,first_party_cookie_status,automatic_matching_fields,data_use_setting,last_fired_time",
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Pixel: ${data.name} (\`${data.id}\`)`, ""];
        if (data.creation_time) lines.push(`- **Created**: ${formatDate(data.creation_time)}`);
        if (data.last_fired_time) lines.push(`- **Last fired**: ${formatDate(data.last_fired_time)}`);
        if (data.is_created_by_business !== undefined) lines.push(`- **Created by business**: ${data.is_created_by_business}`);
        if (data.first_party_cookie_status) lines.push(`- **First-party cookie**: ${data.first_party_cookie_status}`);
        if (data.data_use_setting) lines.push(`- **Data use setting**: ${data.data_use_setting}`);
        if (data.automatic_matching_fields?.length) lines.push(`- **Auto-matching fields**: ${data.automatic_matching_fields.join(", ")}`);
        if (data.code) lines.push("", "### Pixel Code", "```html", truncateField(data.code, 2000), "```");
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Pixel Stats ──────────────────────────────────────────────────
  server.registerTool(
    "meta_get_pixel_stats",
    {
      title: "Get Meta Pixel Stats",
      description: `Gets event volume stats for a pixel (critical for verifying pixel is firing).

Args:
  - pixel_id (string): Pixel ID
  - start_time (string, optional): ISO date for start of range
  - end_time (string, optional): ISO date for end of range
  - aggregation (string, optional): "event" (default), "device_os", "device_type", or another supported schema value
  - event (string, optional): Filter to specific event like "Purchase"`,
      inputSchema: z
        .object({
          pixel_id: z.string(),
          start_time: z.string().optional(),
          end_time: z.string().optional(),
          aggregation: z.enum(["browser_type", "custom_data_field", "device_os", "device_type", "event", "event_detection_method", "event_processing_results", "event_source", "event_total_counts", "event_value_count", "had_pii", "host", "match_keys", "pixel_fire", "url", "url_by_rule"]).default("event"),
          event: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ pixel_id, start_time, end_time, aggregation, event, response_format }) => {
      try {
        const params: Record<string, string> = { aggregation };
        if (start_time) params.start_time = start_time;
        if (end_time) params.end_time = end_time;
        if (event) params.event = event;

        const data = await client.get<{ data: { timestamp?: string; count?: number; event?: string }[] }>(
          `/${pixel_id}/stats`, params
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No stats found for this pixel." }] };
        }

        const lines = [`# Pixel Stats (\`${pixel_id}\`)`, "", `| Timestamp | Event | Count |`, `|-----------|-------|-------|`];
        for (const row of data.data) {
          lines.push(`| ${row.timestamp ? formatDate(row.timestamp) : "—"} | ${row.event ?? "—"} | ${row.count ?? 0} |`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Update Pixel ─────────────────────────────────────────────────────
  server.registerTool(
    "meta_update_pixel",
    {
      title: "Update Meta Pixel",
      description: `Updates pixel settings.

Args:
  - pixel_id (string): Pixel ID
  - name (string, optional): New pixel name
  - first_party_cookie_status (string, optional): "EMPTY", "FIRST_PARTY_COOKIE_ENABLED", or "FIRST_PARTY_COOKIE_DISABLED"
  - automatic_matching_fields (string[], optional): e.g. ["em","ph","fn","ln","ct","st","zp","country","db","ge","external_id"]
  - data_use_setting (string, optional): "EMPTY" or "DATA_USE_SETTING_LDU"`,
      inputSchema: z
        .object({
          pixel_id: z.string(),
          name: z.string().optional(),
          first_party_cookie_status: z.enum(["EMPTY", "FIRST_PARTY_COOKIE_ENABLED", "FIRST_PARTY_COOKIE_DISABLED"]).optional(),
          automatic_matching_fields: z.array(z.string()).optional(),
          data_use_setting: z.enum(["EMPTY", "DATA_USE_SETTING_LDU"]).optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ pixel_id, name, first_party_cookie_status, automatic_matching_fields, data_use_setting, response_format }) => {
      try {
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (first_party_cookie_status !== undefined) body.first_party_cookie_status = first_party_cookie_status;
        if (automatic_matching_fields !== undefined) body.automatic_matching_fields = automatic_matching_fields;
        if (data_use_setting !== undefined) body.data_use_setting = data_use_setting;

        const result = await client.post<{ success: boolean }>(`/${pixel_id}`, body);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Pixel \`${pixel_id}\` updated successfully.` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delete Pixel ─────────────────────────────────────────────────────
  server.registerTool(
    "meta_delete_pixel",
    {
      title: "Delete Meta Pixel",
      description: `Deletes a Meta Pixel.

Args:
  - pixel_id (string): Pixel ID to delete`,
      inputSchema: z
        .object({
          pixel_id: z.string(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ pixel_id }) => {
      try {
        const result = await client.delete<{ success: boolean }>(`/${pixel_id}`);
        return { content: [{ type: "text", text: result.success ? `Pixel \`${pixel_id}\` deleted.` : `Delete returned: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Share Pixel ──────────────────────────────────────────────────────
  server.registerTool(
    "meta_share_pixel",
    {
      title: "Share Meta Pixel",
      description: `Shares a pixel with another ad account.

Args:
  - pixel_id (string): Pixel ID
  - ad_account_id (string): Target ad account ID
  - business_id (string): Business ID`,
      inputSchema: z
        .object({
          pixel_id: z.string(),
          ad_account_id: z.string(),
          business_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ pixel_id, ad_account_id, business_id, response_format }) => {
      try {
        const result = await client.post<{ success: boolean }>(`/${pixel_id}/shared_accounts`, {
          account_id: ad_account_id,
          business: business_id,
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Pixel \`${pixel_id}\` shared with ad account \`${ad_account_id}\`.` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Pixel Events ─────────────────────────────────────────────────
  server.registerTool(
    "meta_get_pixel_events",
    {
      title: "Get Pixel Events",
      description: `Gets recent events received by a pixel (for debugging).

Args:
  - pixel_id (string): Pixel ID`,
      inputSchema: z
        .object({
          pixel_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ pixel_id, response_format }) => {
      try {
        const data = await client.get<{ data: { event_name?: string; count?: number; error_count?: number; error_message?: string }[] }>(
          `/${pixel_id}/test_events`, {}
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No recent events found for this pixel." }] };
        }

        const lines = [`# Recent Pixel Events (\`${pixel_id}\`)`, "", `| Event | Count | Errors | Error Message |`, `|-------|-------|--------|---------------|`];
        for (const evt of data.data) {
          lines.push(`| ${evt.event_name ?? "—"} | ${evt.count ?? 0} | ${evt.error_count ?? 0} | ${truncateField(evt.error_message, 100) ?? "—"} |`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── List Custom Conversions ───────────────────────────────────────────
  server.registerTool(
    "meta_list_custom_conversions",
    {
      title: "List Custom Conversions",
      description: `Lists custom conversions for an ad account.

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
          id: string; name: string; pixel?: { id: string }; custom_event_type?: string; rule?: string; creation_time?: string;
        }>>(`/${ad_account_id}/customconversions`, {
          fields: "id,name,pixel,custom_event_type,rule,creation_time",
        });

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No custom conversions found." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Custom Conversions (${data.data.length})`, ""];
        for (const cc of data.data) {
          lines.push(`## ${cc.name} (\`${cc.id}\`)`);
          if (cc.custom_event_type) lines.push(`- **Event type**: ${cc.custom_event_type}`);
          if (cc.pixel?.id) lines.push(`- **Pixel**: \`${cc.pixel.id}\``);
          if (cc.creation_time) lines.push(`- **Created**: ${formatDate(cc.creation_time)}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Create Custom Conversion ──────────────────────────────────────────
  server.registerTool(
    "meta_create_custom_conversion",
    {
      title: "Create Custom Conversion",
      description: `Creates a custom conversion for tracking specific actions.

Args:
  - ad_account_id (string): Ad account ID
  - name (string): Conversion name
  - pixel_id (string): Pixel ID to associate with
  - custom_event_type (string): Event type — CONTENT_VIEW, SEARCH, ADD_TO_CART, ADD_TO_WISHLIST, INITIATED_CHECKOUT, ADD_PAYMENT_INFO, PURCHASE, LEAD, COMPLETE_REGISTRATION, OTHER
  - rule (string): URL rule as JSON (e.g., {"url":{"i_contains":"thank-you"}})`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          name: z.string().min(1),
          pixel_id: z.string(),
          custom_event_type: z.enum(["CONTENT_VIEW", "SEARCH", "ADD_TO_CART", "ADD_TO_WISHLIST", "INITIATED_CHECKOUT", "ADD_PAYMENT_INFO", "PURCHASE", "LEAD", "COMPLETE_REGISTRATION", "OTHER"]),
          rule: z.string().describe("URL rule as JSON string"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ad_account_id, name, pixel_id, custom_event_type, rule, response_format }) => {
      try {
        const result = await client.post<{ id: string }>(`/${ad_account_id}/customconversions`, {
          name, pixel_id, custom_event_type, rule,
        });

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Custom conversion created.\n\n- **ID**: \`${result.id}\`\n- **Name**: ${name}\n- **Event**: ${custom_event_type}` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
