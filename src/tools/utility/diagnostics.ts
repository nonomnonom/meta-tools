import axios from "axios";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GRAPH_API_VERSION, META_TOOLS_VERSION, THREADS_API_VERSION } from "../../constants.js";
import { MetaApiClient } from "../../services/api.js";
import { ResponseFormatSchema } from "../../services/utils.js";
import type { MetaConnectionStore } from "../../services/meta-connection-store.js";
import type { ServerConfig } from "../../config.js";

export interface DiagnosticsContext {
  serverUrl?: string;
  authIssuer?: string;
  principalId?: string;
  connectionStore?: MetaConnectionStore;
  config?: ServerConfig;
  toolGroups: string[];
}

interface ConnectionCheck {
  service: "Graph API" | "Threads API";
  status: "connected" | "error" | "skipped";
  latency_ms?: number;
  http_status?: number;
  error_code?: number | string;
  error_subcode?: number;
  summary?: string;
  next_step?: string;
}

interface ApiErrorDetails {
  code?: number | string;
  subcode?: number;
  httpStatus?: number;
  hasResponse: boolean;
}

function diagnoseConnectionError(service: ConnectionCheck["service"], error: ApiErrorDetails): Omit<ConnectionCheck, "service" | "status" | "latency_ms"> {
  if (!error.hasResponse && !error.code) {
    return { summary: "The request failed before the API returned a response.", next_step: "Check the server network and API hostname." };
  }

  const code = error.code;
  const subcode = error.subcode;
  const httpStatus = error.httpStatus;
  if (code === 190 || error.httpStatus === 401) {
    return { error_code: code, error_subcode: subcode, http_status: httpStatus, summary: "The access token is invalid, expired, or no longer accepted.", next_step: "Run meta_debug_token and replace the expired or revoked token." };
  }
  if (code === 10 || code === 200 || httpStatus === 403) {
    return { error_code: code ?? httpStatus, error_subcode: subcode, http_status: httpStatus, summary: "The token is missing permission for this API call.", next_step: "Check app review, granted scopes, and the connected account's access." };
  }
  if ([2, 4, 17, 32, 613, 80004].includes(Number(code)) || httpStatus === 429) {
    return { error_code: code ?? httpStatus, error_subcode: subcode, http_status: httpStatus, summary: "The API rate limit was reached.", next_step: "Reduce request frequency and retry after the limit window." };
  }
  if (typeof code === "string" && ["ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET"].includes(code)) {
    return { error_code: code, summary: "The server could not reach the API or the request timed out.", next_step: "Check outbound DNS, TLS, firewall rules, and network availability." };
  }
  if (!error.hasResponse) {
    return { error_code: code ?? "NETWORK_ERROR", summary: "The server could not reach the API.", next_step: "Check outbound DNS, TLS, firewall rules, and network availability." };
  }
  if (code === 100) {
    return { error_code: code, error_subcode: subcode, http_status: httpStatus, summary: "A request parameter or field is not supported for this object or API version.", next_step: "Check the tool arguments, object ID type, and requested fields against the current API version." };
  }
  if (code === 368) {
    return { error_code: code, error_subcode: subcode, http_status: httpStatus, summary: "Meta restricted this action or account from performing the requested operation.", next_step: "Check account quality and policy restrictions in Meta Business Support Home." };
  }
  return { error_code: code ?? httpStatus ?? "API_ERROR", error_subcode: subcode, http_status: httpStatus, summary: `${service} returned an API error.`, next_step: "Inspect the Meta app status, API version, and endpoint permissions." };
}

async function checkConnection(
  service: ConnectionCheck["service"],
  configured: boolean,
  request: () => Promise<unknown>
): Promise<ConnectionCheck> {
  if (!configured) return { service, status: "skipped", next_step: "Configure this API's access token to enable the check." };
  const started = performance.now();
  try {
    await request();
    return { service, status: "connected", latency_ms: Math.round(performance.now() - started) };
  } catch (error) {
    const response = axios.isAxiosError(error) ? error.response : undefined;
    const apiError: ApiErrorDetails = response
      ? {
          code: (response.data as { error?: { code?: number } } | undefined)?.error?.code ?? response.status,
          subcode: (response.data as { error?: { error_subcode?: number } } | undefined)?.error?.error_subcode,
          httpStatus: response.status,
          hasResponse: true,
        }
      : { code: axios.isAxiosError(error) ? error.code : undefined, hasResponse: false };
    return {
      service,
      status: "error",
      latency_ms: Math.round(performance.now() - started),
      ...diagnoseConnectionError(service, apiError),
    };
  }
}

function formatCheck(check: ConnectionCheck): string {
  const detail = check.status === "connected"
    ? `connected (${check.latency_ms} ms)`
    : check.status === "skipped"
      ? "skipped; token not configured"
      : `${check.summary} [code ${check.error_code ?? "unknown"}${check.http_status ? `, HTTP ${check.http_status}` : ""}]`;
  return `- **${check.service}**: ${detail}${check.next_step ? `\n  - Next: ${check.next_step}` : ""}`;
}

export function registerDiagnosticTools(server: McpServer, client: MetaApiClient, context: DiagnosticsContext): void {
  server.registerTool(
    "meta_server_diagnostics",
    {
      title: "Inspect MCP Server Runtime",
      description: "Returns local, read-only diagnostics for this MCP process. Reports configuration presence and runtime details without contacting Meta or revealing credentials.",
      inputSchema: z.object({ response_format: ResponseFormatSchema }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ response_format }) => {
      const diagnostics = {
        status: "running",
        server: { name: "meta-tools", version: META_TOOLS_VERSION, endpoint: context.serverUrl ?? "unknown", authorization_issuer: context.authIssuer ?? "unknown" },
        runtime: { node: process.version, platform: process.platform, arch: process.arch, uptime_seconds: Math.floor(process.uptime()) },
        api: { graph_version: GRAPH_API_VERSION, threads_version: THREADS_API_VERSION },
        credentials: { meta_access_token: client.hasUserToken(), threads_access_token: client.hasThreadsToken(), page_tokens_cached: client.getPageTokenCount() },
        tool_groups: [...context.toolGroups].sort(),
        generated_at: new Date().toISOString(),
      };
      if (response_format === "json") return { content: [{ type: "text", text: JSON.stringify(diagnostics, null, 2) }] };
      return { content: [{ type: "text", text: [
        "# MCP Server Diagnostics", "", `- **Status**: ${diagnostics.status}`,
        `- **Runtime**: Node ${diagnostics.runtime.node} (${diagnostics.runtime.platform}/${diagnostics.runtime.arch})`,
        `- **Uptime**: ${diagnostics.runtime.uptime_seconds}s`,
        `- **Endpoint**: ${diagnostics.server.endpoint}`,
        `- **Tool groups**: ${diagnostics.tool_groups.join(", ")}`,
        `- **Meta token configured**: ${diagnostics.credentials.meta_access_token ? "yes" : "no"}`,
        `- **Threads token configured**: ${diagnostics.credentials.threads_access_token ? "yes" : "no"}`,
        `- **Cached Page tokens**: ${diagnostics.credentials.page_tokens_cached}`,
        `- **API versions**: Graph ${GRAPH_API_VERSION}; Threads ${THREADS_API_VERSION}`,
      ].join("\n") }] };
    }
  );

  const registerConnectionCheckTool = (name: string, title: string) => server.registerTool(
    name,
    {
      title,
      description: "Performs read-only /me checks against configured Graph and Threads APIs. Returns per-service status, latency, error codes, and a suggested next step. It never includes access-token values.",
      inputSchema: z.object({
        apis: z.array(z.enum(["graph", "threads"])).min(1).max(2).default(["graph", "threads"]),
        response_format: ResponseFormatSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ apis, response_format }) => {
      const checks: ConnectionCheck[] = [];
      if (apis.includes("graph")) {
        checks.push(await checkConnection("Graph API", client.hasUserToken(), () => client.get("/me", { fields: "id" })));
      }
      if (apis.includes("threads")) {
        checks.push(await checkConnection("Threads API", client.hasThreadsToken(), () => client.threadsGet("/me", { fields: "id" })));
      }
      const result = { status: checks.some((check) => check.status === "error") ? "unhealthy" : checks.some((check) => check.status === "skipped") ? "degraded" : "healthy", checks };
      if (response_format === "json") return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      return { content: [{ type: "text", text: [`# API Connection Checks (${result.status})`, "", ...checks.map(formatCheck)].join("\n") }] };
    }
  );
  registerConnectionCheckTool("meta_check_api_connections", "Check Meta API Connections");
  registerConnectionCheckTool("meta_health_check", "Meta MCP Health Check");

  server.registerTool(
    "meta_diagnose_api_error",
    {
      title: "Explain a Meta API Error",
      description: "Maps a Meta Graph or Threads API error code and optional HTTP status to likely causes and actionable troubleshooting steps. Does not make network calls.",
      inputSchema: z.object({
        api: z.enum(["graph", "threads"]).default("graph"),
        error_code: z.union([z.number(), z.string()]).optional(),
        error_subcode: z.number().optional(),
        http_status: z.number().int().min(100).max(599).optional(),
        response_format: ResponseFormatSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ api, error_code, error_subcode, http_status, response_format }) => {
      const code = Number(error_code);
      const diagnosis = error_code === undefined && http_status === undefined
        ? { summary: "Provide a Meta API error code or HTTP status to get a targeted diagnosis.", next_step: "Pass error_code, http_status, or both from the failed API response." }
        : diagnoseConnectionError(api === "graph" ? "Graph API" : "Threads API", {
        code: error_code !== undefined ? (Number.isNaN(code) ? error_code : code) : http_status,
        subcode: error_subcode,
        httpStatus: http_status,
        hasResponse: http_status !== undefined || error_code !== undefined,
      });
      const result = { api, error_code, error_subcode, http_status, ...diagnosis };
      if (response_format === "json") return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      return { content: [{ type: "text", text: `# API Error Diagnosis\n\n- **API**: ${api}\n- **Error code**: ${error_code ?? "not provided"}\n- **HTTP status**: ${http_status ?? "not provided"}\n- **Likely cause**: ${result.summary ?? "Unrecognized error; inspect the server logs and Meta API response."}\n- **Next step**: ${result.next_step ?? "Check the relevant Meta developer documentation."}` }] };
    }
  );
}
