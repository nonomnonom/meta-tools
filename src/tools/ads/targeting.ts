import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, truncate, formatNumber, ResponseFormatSchema } from "../../services/utils.js";
import { Ad } from "../../types.js";

export function registerTargetingTools(server: McpServer, client: MetaApiClient): void {
  // ─── Targeting Search: Interests ───────────────────────────────────────
  server.registerTool(
    "meta_search_targeting_interests",
    {
      title: "Search Targeting Interests",
      description: `Searches for interest-based targeting options for ad sets.

Args:
  - q (string): Search query (e.g., "yoga", "cooking")
  - limit (number): Max results (default 50)

Returns: Interest IDs and names to use in ad set targeting.`,
      inputSchema: z
        .object({
          q: z.string().min(1).describe("Interest search query"),
          limit: z.number().int().min(1).max(100).default(50),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ q, limit, response_format }) => {
      try {
        const data = await client.get<{ data: Array<{ id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; path?: string[]; topic?: string }> }>(
          "/search",
          { type: "adinterest", q, limit }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: `No interests found for "${q}".` }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
        }

        const lines = [`# Targeting Interests: "${q}" (${data.data.length})`, ""];
        for (const i of data.data) {
          const size = i.audience_size_lower_bound ? `~${formatNumber(i.audience_size_lower_bound)}–${formatNumber(i.audience_size_upper_bound)}` : "N/A";
          lines.push(`- **${i.name}** (\`${i.id}\`) — Audience: ${size}${i.path?.length ? ` | Path: ${i.path.join(" > ")}` : ""}`);
        }
        return { content: [{ type: "text", text: truncate(lines.join("\n"), "interests") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Targeting Search: Geolocations ────────────────────────────────────
  server.registerTool(
    "meta_search_targeting_geolocations",
    {
      title: "Search Targeting Geolocations",
      description: `Searches for geographic targeting options (countries, regions, cities, zip codes).

Args:
  - q (string): Location search query (e.g., "New York", "United Kingdom")
  - type (string): Location type — country, region, city, zip, geo_market, electoral_district
  - limit (number): Max results (default 25)

Returns: Location keys to use in ad set targeting.`,
      inputSchema: z
        .object({
          q: z.string().min(1),
          type: z.enum(["country", "region", "city", "zip", "geo_market", "electoral_district"]).default("city"),
          limit: z.number().int().min(1).max(100).default(25),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ q, type, limit, response_format }) => {
      try {
        const data = await client.get<{ data: Array<{ key: string; name: string; type: string; country_code?: string; region?: string; supports_city?: boolean; supports_region?: boolean }> }>(
          "/search",
          { type: "adgeolocation", q, location_types: `["${type}"]`, limit }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: `No geolocations found for "${q}".` }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
        }

        const lines = [`# Geolocations: "${q}" (${data.data.length})`, ""];
        for (const loc of data.data) {
          lines.push(`- **${loc.name}** (key: \`${loc.key}\`, type: ${loc.type})${loc.country_code ? ` — ${loc.country_code}` : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Targeting Search: Demographics ────────────────────────────────────
  server.registerTool(
    "meta_search_targeting_demographics",
    {
      title: "Search Targeting Demographics",
      description: `Searches for demographic targeting options (job titles, employers, education).

Args:
  - q (string): Search query
  - type (string): adworkposition (job titles), adworkemployer (employers), adeducationschool (schools), adeducationmajor (majors)`,
      inputSchema: z
        .object({
          q: z.string().min(1),
          type: z.enum(["adworkposition", "adworkemployer", "adeducationschool", "adeducationmajor"]),
          limit: z.number().int().min(1).max(100).default(25),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ q, type, limit, response_format }) => {
      try {
        const data = await client.get<{ data: Array<{ id: string; name: string }> }>(
          "/search",
          { type, q, limit }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: `No results found for "${q}" (${type}).` }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
        }

        const lines = [`# ${type}: "${q}" (${data.data.length})`, ""];
        for (const item of data.data) {
          lines.push(`- **${item.name}** (\`${item.id}\`)`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Reach Estimate ────────────────────────────────────────────────────
  server.registerTool(
    "meta_get_reach_estimate",
    {
      title: "Get Reach Estimate",
      description: `Estimates the potential reach for a targeting specification.

Args:
  - ad_account_id (string): Ad account ID
  - targeting_spec (object): Targeting specification (same format as ad set targeting)
  - optimization_goal (string, optional): e.g., REACH, LINK_CLICKS, IMPRESSIONS

Returns: Estimated daily reach and audience size.`,
      inputSchema: z
        .object({
          ad_account_id: z.string(),
          targeting_spec: z.record(z.unknown()).describe("Targeting spec object"),
          optimization_goal: z.string().optional(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ ad_account_id, targeting_spec, optimization_goal, response_format }) => {
      try {
        const params: Record<string, unknown> = {
          targeting_spec: JSON.stringify(targeting_spec),
        };
        if (optimization_goal) params.optimization_goal = optimization_goal;

        const data = await client.get<{ data: { users_lower_bound: number; users_upper_bound: number; estimate_dau?: number; estimate_mau?: number; estimate_ready?: boolean } }>(
          `/${ad_account_id}/reachestimate`,
          params
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const d = data.data;
        const lines = [
          `# Reach Estimate`,
          "",
          `- **Audience Size**: ${formatNumber(d.users_lower_bound)}–${formatNumber(d.users_upper_bound)}`,
          d.estimate_dau ? `- **Daily Active Users**: ~${formatNumber(d.estimate_dau)}` : "",
          d.estimate_mau ? `- **Monthly Active Users**: ~${formatNumber(d.estimate_mau)}` : "",
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Delivery Estimate ─────────────────────────────────────────────────
  server.registerTool(
    "meta_get_delivery_estimate",
    {
      title: "Get Delivery Estimate",
      description: `Gets delivery estimate for an existing ad set.

Args:
  - adset_id (string): Ad set ID

Returns: Estimated daily outcomes (reach, impressions, actions) and bid suggestion.`,
      inputSchema: z
        .object({
          adset_id: z.string(),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ adset_id, response_format }) => {
      try {
        const data = await client.get<{ data: unknown[] }>(
          `/${adset_id}/delivery_estimate`,
          { fields: "daily_outcomes_curve,estimate_dau,estimate_mau,bid_estimate" }
        );

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        return { content: [{ type: "text", text: `# Delivery Estimate for \`${adset_id}\`\n\n${JSON.stringify(data.data, null, 2)}` }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
