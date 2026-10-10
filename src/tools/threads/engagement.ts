import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, formatNumber, formatDate, ResponseFormatSchema } from "../../services/utils.js";
import { ThreadsReply, MetaPaginatedResponse } from "../../types.js";

export function registerThreadsReplyAndInsightTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Thread Replies ───────────────────────────────────────────────────
  server.registerTool(
    "threads_get_replies",
    {
      title: "Get Thread Replies",
      description: `Gets replies to a Threads post.

Args:
  - media_id (string): Threads media ID
  - reverse (boolean, optional): Reverse chronological order (default false)`,
      inputSchema: z
        .object({
          media_id: z.string(),
          reverse: z.boolean().default(false),
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
    async ({ media_id, reverse, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,text,username,timestamp,media_type,hide_status",
          reverse,
        };

        const data = await client.threadsGet<MetaPaginatedResponse<ThreadsReply>>(
          `/${media_id}/replies`,
          params
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No replies on this thread." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Replies to \`${media_id}\` (${data.data.length})`, ""];
        for (const reply of data.data) {
          lines.push(`**@${reply.username ?? "unknown"}** (${formatDate(reply.timestamp)})`);
          if (reply.text) lines.push(`> ${reply.text}`);
          if (reply.hide_status === "HIDDEN") lines.push(`_[hidden]_`);
          lines.push(`_ID: \`${reply.id}\`_`);
          lines.push("");
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "replies") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Hide/Unhide Thread Reply ─────────────────────────────────────────────
  server.registerTool(
    "threads_hide_reply",
    {
      title: "Hide/Unhide Thread Reply",
      description: `Hides or unhides a reply on a Threads post.

Args:
  - reply_id (string): Reply media ID
  - hide (boolean): true to hide, false to unhide`,
      inputSchema: z
        .object({
          reply_id: z.string(),
          hide: z.boolean().describe("true to hide, false to unhide"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ reply_id, hide }) => {
      try {
        await client.threadsPost(`/${reply_id}/manage_reply`, { hide });
        return {
          content: [{
            type: "text",
            text: `Reply \`${reply_id}\` ${hide ? "hidden" : "unhidden"}.`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Thread Post Insights ─────────────────────────────────────────────
  server.registerTool(
    "threads_get_post_insights",
    {
      title: "Get Thread Post Insights",
      description: `Gets performance metrics for a specific Threads post.

Args:
  - media_id (string): Threads media ID
  - metrics (string[]): Metrics to retrieve. Options: views, likes, replies, reposts, quotes, shares, reach, saved

Returns: Metric values for the post.`,
      inputSchema: z
        .object({
          media_id: z.string(),
          metrics: z
            .array(z.string())
            .default(["views", "likes", "replies", "reposts", "quotes"])
            .describe("Metric names"),
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
    async ({ media_id, metrics, response_format }) => {
      try {
        const data = await client.threadsGet<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
          `/${media_id}/insights`,
          { metric: metrics.join(",") }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Thread Insights: \`${media_id}\``, ""];
        for (const item of data.data) {
          const val = item.values?.[0]?.value ?? "N/A";
          lines.push(`- **${item.name}**: ${formatNumber(val)}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Get Threads User Insights ────────────────────────────────────────────
  server.registerTool(
    "threads_get_user_insights",
    {
      title: "Get Threads User Insights",
      description: `Gets account-level metrics for the authenticated Threads user.

Args:
  - threads_user_id (string): Threads user ID
  - metrics (string[]): Options:
      Time-series: views, likes, replies, reposts, quotes, followers_count, reach
      Demographics: follower_demographics (breakdown by age, country, city, gender — requires 100+ followers)
  - since (string, optional): Start date YYYY-MM-DD (required for time-series metrics)
  - until (string, optional): End date YYYY-MM-DD
  - breakdown (string, optional): For follower_demographics: 'age', 'country', 'city', 'gender'`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
          metrics: z
            .array(z.string())
            .default(["views", "likes", "replies", "reposts", "quotes", "followers_count", "reach"]),
          since: z.string().optional(),
          until: z.string().optional(),
          breakdown: z.enum(["age", "country", "city", "gender"]).optional().describe("For follower_demographics metric only"),
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
    async ({ threads_user_id, metrics, since, until, breakdown, response_format }) => {
      try {
        const params: Record<string, unknown> = { metric: metrics.join(",") };
        if (since) params.since = since;
        if (until) params.until = until;
        if (breakdown) params.breakdown = breakdown;

        const data = await client.threadsGet<{ data: Array<{ name: string; title?: string; total_value?: { value: number }; values?: Array<{ value: unknown }> }> }>(
          `/${threads_user_id}/threads_insights`,
          params
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Threads User Insights`, ""];
        for (const item of data.data) {
          const val = item.total_value?.value ?? item.values?.[0]?.value ?? "N/A";
          lines.push(`- **${item.title ?? item.name}**: ${typeof val === "number" ? formatNumber(val) : JSON.stringify(val)}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Check Threads Publishing Limit ───────────────────────────────────────
  server.registerTool(
    "threads_check_rate_limits",
    {
      title: "Check Threads Publishing Limits",
      description: `Checks the current publishing rate limit usage for Threads.

Args:
  - threads_user_id (string): Threads user ID

Returns: Current usage and limit quota (250 posts per 24 hours).`,
      inputSchema: z
        .object({
          threads_user_id: z.string(),
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
    async ({ threads_user_id, response_format }) => {
      try {
        const data = await client.threadsGet<{ data: Array<{ quota_usage: number; config: { quota_total: number; quota_duration: number }; reply_quota_usage: number; reply_config: { quota_total: number; quota_duration: number } }> }>(
          `/${threads_user_id}/threads_publishing_limit`,
          { fields: "quota_usage,config,reply_quota_usage,reply_config" }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const limit = data.data[0];
        if (!limit) {
          return { content: [{ type: "text", text: "No rate limit data available." }] };
        }

        const lines = [
          `# Threads Publishing Limits`,
          "",
          `- **Posts used**: ${limit.quota_usage} / ${limit.config?.quota_total ?? 250}`,
          `- **Replies used**: ${limit.reply_quota_usage ?? "N/A"} / ${limit.reply_config?.quota_total ?? 1000}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
