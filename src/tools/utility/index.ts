import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MetaApiClient } from "../../services/api.js";
import { errorResult, formatDate, ResponseFormatSchema } from "../../services/utils.js";
import { registerDiagnosticTools, type DiagnosticsContext } from "./diagnostics.js";

export function registerUtilityTools(
  server: McpServer,
  client: MetaApiClient,
  diagnostics: DiagnosticsContext = { toolGroups: ["utility"] }
): void {
  server.registerTool(
    "meta_debug_token",
    {
      title: "Debug Meta Access Token",
      description: "Inspects the configured Meta token's validity, expiry, app, and granted scopes. The access-token value is never returned.",
      inputSchema: z.object({ response_format: ResponseFormatSchema }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ response_format }) => {
      try {
        client.requireUserToken();
        const data = await client.get<{
          data: {
            app_id: string;
            type: string;
            application: string;
            data_access_expires_at: number;
            expires_at: number;
            is_valid: boolean;
            issued_at?: number;
            scopes: string[];
            user_id?: string;
            profile_id?: string;
            granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
          };
        }>("/debug_token", { input_token: client.getUserToken() });
        const info = data.data;
        const safeInfo = {
          app_id: info.app_id,
          type: info.type,
          application: info.application,
          data_access_expires_at: info.data_access_expires_at,
          expires_at: info.expires_at,
          is_valid: info.is_valid,
          issued_at: info.issued_at,
          scopes: info.scopes,
          user_id: info.user_id,
          profile_id: info.profile_id,
          granular_scopes: info.granular_scopes,
        };
        if (response_format === "json") return { content: [{ type: "text", text: JSON.stringify(safeInfo, null, 2) }] };

        const expiresAt = info.expires_at === 0
          ? "Never (long-lived system user token)"
          : info.expires_at
            ? formatDate(new Date(info.expires_at * 1000).toISOString())
            : "Unknown";
        const dataAccessExpires = info.data_access_expires_at
          ? formatDate(new Date(info.data_access_expires_at * 1000).toISOString())
          : "Unknown";
        const lines = [
          "# Meta Token Diagnostics", "",
          `- **Valid**: ${info.is_valid ? "Yes" : "No — token is invalid or expired"}`,
          `- **Type**: ${info.type}`,
          `- **App**: ${info.application} (${info.app_id})`,
          info.user_id ? `- **User ID**: ${info.user_id}` : "",
          info.profile_id ? `- **Profile ID**: ${info.profile_id}` : "",
          `- **Expires**: ${expiresAt}`,
          `- **Data access expires**: ${dataAccessExpires}`,
          "", `## Permissions (${info.scopes?.length ?? 0})`, "",
          ...(info.scopes?.map((scope) => `- ${scope}`) ?? ["- No scopes returned"]),
          ...(info.is_valid ? [] : ["", "Run meta_check_api_connections after replacing the token to confirm access."]),
        ].filter(Boolean);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  registerDiagnosticTools(server, client, diagnostics);
}
