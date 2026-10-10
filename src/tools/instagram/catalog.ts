import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, ResponseFormatSchema } from "../../services/utils.js";

export function registerInstagramCommerceTools(server: McpServer, client: MetaApiClient): void {
  // ─── Get Instagram Available Catalogs ───────────────────────────────────
  server.registerTool(
    "meta_get_instagram_available_catalogs",
    {
      title: "Get Instagram Available Catalogs",
      description: `Lists product catalogs available for Instagram Shopping on a professional account.

Args:
  - ig_account_id (string): Instagram account ID

Returns: Catalog IDs and names that can be used for product tagging on this account.

Requires: instagram_shopping_tag_products permission.`,
      inputSchema: z
        .object({
          ig_account_id: z.string().describe("Instagram account ID"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ ig_account_id, response_format }) => {
      try {
        const data = await client.get<{ data: Array<{ id: string; name?: string; product_count?: number }> }>(
          `/${ig_account_id}/available_catalogs`,
          { fields: "id,name,product_count" }
        );

        if (!data.data?.length) {
          return { content: [{ type: "text", text: "No catalogs available for Instagram Shopping on this account." }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Instagram Available Catalogs (${data.data.length})`, ""];
        for (const cat of data.data) {
          lines.push(`- **${cat.name ?? "Unnamed"}** (\`${cat.id}\`)${cat.product_count !== undefined ? ` — ${cat.product_count} products` : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // ─── Search Instagram Catalog Products ──────────────────────────────────
  server.registerTool(
    "meta_search_instagram_catalog_products",
    {
      title: "Search Instagram Catalog Products",
      description: `Searches for products in an Instagram Shopping catalog by name.

Args:
  - ig_account_id (string): Instagram account ID
  - catalog_id (string): Product catalog ID (from meta_get_instagram_available_catalogs)
  - q (string): Product search query

Returns: Matching products that can be tagged in Instagram posts.`,
      inputSchema: z
        .object({
          ig_account_id: z.string().describe("Instagram account ID"),
          catalog_id: z.string().describe("Product catalog ID"),
          q: z.string().min(1).describe("Product search query"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ ig_account_id, catalog_id, q, response_format }) => {
      try {
        const data = await client.get<{ data: Array<{
          product_id: string;
          merchant_id?: string;
          product_name?: string;
          image_url?: string;
          retailer_id?: string;
          review_status?: string;
        }> }>(`/${ig_account_id}/catalog_product_search`, {
          catalog_id,
          q,
          fields: "product_id,merchant_id,product_name,image_url,retailer_id,review_status",
        });

        if (!data.data?.length) {
          return { content: [{ type: "text", text: `No products found for "${q}".` }] };
        }

        if (response_format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [`# Catalog Products: "${q}" (${data.data.length})`, ""];
        for (const p of data.data) {
          lines.push(`- **${p.product_name ?? "Unknown"}** (\`${p.product_id}\`)${p.review_status ? ` — ${p.review_status}` : ""}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
