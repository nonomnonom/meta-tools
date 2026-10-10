import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, formatNumber, formatDate, ResponseFormatSchema } from "../../services/utils.js";

export function registerPageInsightsTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Page Insights ─────────────────────────────────────────────────────
  server.registerTool(
    "meta_get_page_insights",
    {
      title: "Get Facebook Page Insights",
      description: `Gets analytics/insights for a Facebook Page.

Requires: meta_list_pages called first.

Args:
  - page_id (string): Facebook Page ID
  - metrics (string[]): Defaults to page_media_view, page_total_media_view_unique, page_actions_post_reactions_total, and page_video_views. Supply other metric names supported by your Graph API version explicitly.
  - period (string): Defaults to 'day'. Default metrics support 'day'. View metrics also support 'week' and 'days_28'; choose explicit metrics for other periods.
  - since (string, optional): Start date YYYY-MM-DD
  - until (string, optional): End date YYYY-MM-DD

Returns: Time-series data for each metric.`,
      inputSchema: z
        .object({
          page_id: z.string(),
          metrics: z
            .array(z.string())
            .default([
              "page_media_view",
              "page_total_media_view_unique",
              "page_actions_post_reactions_total",
              "page_video_views",
            ])
            .describe("Metric names supported by your Graph API version"),
          period: z
            .enum(["day", "week", "days_28", "month"])
            .default("day")
            .describe("Aggregation period"),
          since: z.string().optional().describe("Start date YYYY-MM-DD"),
          until: z.string().optional().describe("End date YYYY-MM-DD"),
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
    async ({ page_id, metrics, period, since, until, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const params: Record<string, unknown> = {
          metric: metrics.join(","),
          period,
        };
        if (since) params.since = since;
        if (until) params.until = until;

        const data = await client.getWithToken<{ data: unknown[] }>(
          `/${page_id}/insights`,
          pageToken,
          params
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Page Insights: \`${page_id}\``, `**Period**: ${period}`, ""];
        for (const item of data.data as Array<{
          name: string;
          title: string;
          period: string;
          values: Array<{ value: number; end_time: string }>;
        }>) {
          lines.push(`## ${item.title} (\`${item.name}\`)`);
          if (item.values?.length) {
            for (const v of item.values.slice(-7)) {
              lines.push(`- ${formatDate(v.end_time)}: **${formatNumber(v.value)}**`);
            }
          } else {
            lines.push("_No data available_");
          }
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "metrics") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Post Insights ───────────────────────────────────────────────────
  server.registerTool(
    "meta_get_post_insights",
    {
      title: "Get Facebook Post Insights",
      description: `Gets performance metrics for a specific Facebook Page post.

Requires: meta_list_pages called first.

Args:
  - post_id (string): Post ID (e.g., "page_id_post_id")
  - page_id (string): Page ID (for authentication)
  - metrics (string[]): Defaults to post_media_view, post_total_media_view_unique, and post_reactions_by_type_total. Supply other metric names supported by your Graph API version explicitly.

The default post metrics use the lifetime period (cumulative from post creation).`,
      inputSchema: z
        .object({
          post_id: z.string().describe("Post ID"),
          page_id: z.string().describe("Page ID (for auth)"),
          metrics: z
            .array(z.string())
            .default([
              "post_media_view",
              "post_total_media_view_unique",
              "post_reactions_by_type_total",
            ])
            .describe("Metric names supported by your Graph API version"),
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
    async ({ post_id, page_id, metrics, response_format }) => {
      try {
        const pageToken = client.requirePageToken(page_id);
        const data = await client.getWithToken<{ data: unknown[] }>(
          `/${post_id}/insights`,
          pageToken,
          { metric: metrics.join(",") }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Post Insights: \`${post_id}\``, ""];
        for (const item of data.data as Array<{
          name: string;
          title: string;
          period: string;
          values: Array<{ value: number | Record<string, number> }>;
        }>) {
          const val = item.values?.[0]?.value;
          if (typeof val === "object" && val !== null) {
            lines.push(`## ${item.title ?? item.name}`);
            for (const [k, v] of Object.entries(val)) {
              lines.push(`- ${k}: **${formatNumber(v)}**`);
            }
          } else {
            lines.push(`- **${item.title ?? item.name}**: ${formatNumber(val as number)}`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
