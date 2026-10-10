import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, formatNumber, formatDate, ResponseFormatSchema } from "../../services/utils.js";

export function registerInstagramInsightsTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Instagram Account Insights ──────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_account_insights",
    {
      title: "Get Instagram Account Insights",
      description: `Gets performance insights for an Instagram professional account.

Args:
  - ig_account_id (string): Instagram account ID
  - metrics (string[]): Metrics to retrieve. Options:
      Interactions: accounts_engaged, total_interactions, likes, comments, shares, saves, replies, reposts, reach, views, profile_links_taps, account_repost_count
      Legacy: impressions (deprecated v22.0+), follower_count, email_contacts, phone_call_clicks, text_message_clicks, get_directions_clicks, profile_views, website_clicks
      Demographics: engaged_audience_demographics, reached_audience_demographics, follower_demographics, online_followers

Note: account_repost_count (Dec 2025) returns the total number of reposts across the account for the given period.
  - metric_type (string): 'total_value' (default, required by interaction metrics) or 'time_series' (for supporting metrics such as reach).
  - period (string): 'day', 'week', 'days_28', 'month', 'lifetime' (lifetime only for demographic metrics)
  - since (string, optional): Start date YYYY-MM-DD
  - until (string, optional): End date YYYY-MM-DD
  - breakdown (string, optional): For demographic metrics: 'age', 'city', 'country', 'gender'
  - timeframe (string, optional): For demographic metrics: 'last_14_days', 'last_30_days', 'last_90_days', 'this_month', 'this_week'

Note: demographic metrics require 100+ followers. online_followers only available for last 30 days.`,
      inputSchema: z
        .object({
          ig_account_id: z.string(),
          metrics: z
            .array(z.string())
            .default(["reach", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves", "profile_links_taps", "account_repost_count"])
            .describe("Metric names (see description for full list)"),
          period: z.enum(["day", "week", "days_28", "month", "lifetime"]).default("day"),
          metric_type: z.enum(["time_series", "total_value"]).default("total_value").describe("Aggregation type supported by the requested metrics"),
          since: z.string().optional(),
          until: z.string().optional(),
          breakdown: z.enum(["age", "city", "country", "gender"]).optional().describe("For demographic metrics only"),
          timeframe: z.enum(["last_14_days", "last_30_days", "last_90_days", "prev_month", "this_month", "this_week"]).optional().describe("For demographic metrics only"),
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
    async ({ ig_account_id, metrics, period, metric_type, since, until, breakdown, timeframe, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          metric: metrics.join(","),
          period,
          metric_type,
        };
        if (since) params.since = since;
        if (until) params.until = until;
        if (breakdown) params.breakdown = breakdown;
        if (timeframe) params.timeframe = timeframe;

        const data = await client.get<{ data: unknown[] }>(`/${ig_account_id}/insights`, params);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Instagram Account Insights`, `**Period**: ${period}`, ""];
        for (const item of data.data as Array<{
          name: string;
          title: string;
          period: string;
          values?: Array<{ value: number; end_time: string }>;
          total_value?: {
            value?: number;
            breakdowns?: Array<{
              dimension_keys: string[];
              results: Array<{ dimension_values: string[]; value: number }>;
            }>;
          };
        }>) {
          lines.push(`## ${item.title ?? item.name}`);
          if (item.total_value) {
            if (item.total_value.value !== undefined) {
              lines.push(`- Total: **${formatNumber(item.total_value.value)}**`);
            }
            for (const breakdown of item.total_value.breakdowns ?? []) {
              lines.push(`**${breakdown.dimension_keys.join(" / ")}**`);
              for (const result of breakdown.results) {
                lines.push(`- ${result.dimension_values.join(" / ")}: **${formatNumber(result.value)}**`);
              }
            }
          }
          if (item.values?.length) {
            for (const v of item.values.slice(-7)) {
              lines.push(`- ${formatDate(v.end_time)}: **${formatNumber(v.value)}**`);
            }
          }
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "metrics") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Instagram Media Insights ─────────────────────────────────────────
  server.registerTool(
    "meta_get_instagram_media_insights",
    {
      title: "Get Instagram Media Insights",
      description: `Gets performance metrics for a specific Instagram media object.

Args:
  - media_id (string): Instagram media ID (from meta_get_instagram_media)
  - metrics (string[]): Metrics vary by media type:
      Photos/Carousels: reach, likes, comments, shares, saved, total_interactions, follows, profile_visits, profile_activity, views, impressions (deprecated)
      Reels/Video: reach, likes, comments, shares, saved, total_interactions, follows, profile_visits, profile_activity, views, ig_reels_avg_watch_time, ig_reels_video_view_total_time, reels_skip_rate, repost_count, crossposted_views, facebook_views, impressions (deprecated), plays (deprecated), clips_replays_count (deprecated)
      Stories: reach, shares, follows, profile_visits, profile_activity, replies, navigation, total_interactions, views, impressions (deprecated)

  New Reels metrics (Dec 2025):
    - reels_skip_rate: Percentage of viewers who skip within first 3 seconds
    - repost_count: Number of reposts of this media
    - crossposted_views: Total views across Instagram and Facebook (for crossposted content)
    - facebook_views: Facebook-specific views for crossposted Reels

  - breakdown (string, optional): 'action_type' (for profile_activity) or 'story_navigation_action_type' (for navigation)`,
      inputSchema: z
        .object({
          media_id: z.string().describe("Instagram media ID"),
          metrics: z
            .array(z.string())
            .default(["reach", "likes", "comments", "shares", "saved", "total_interactions", "repost_count"])
            .describe("Metric names (options depend on media type — see description)"),
          breakdown: z.enum(["action_type", "story_navigation_action_type"]).optional().describe("For profile_activity or navigation metrics"),
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
    async ({ media_id, metrics, breakdown, response_format }) => {
      try {
        const params: Record<string, unknown> = { metric: metrics.join(",") };
        if (breakdown) params.breakdown = breakdown;
        const data = await client.get<{ data: unknown[] }>(`/${media_id}/insights`, params);

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Media Insights: \`${media_id}\``, ""];
        for (const item of data.data as Array<{
          name: string;
          title: string;
          period: string;
          values: Array<{ value: number }>;
        }>) {
          const val = item.values?.[0]?.value ?? "N/A";
          lines.push(`- **${item.title ?? item.name}**: ${formatNumber(val)}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
