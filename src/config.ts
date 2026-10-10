export const TOOL_GROUPS = [
  "ad-library",
  "ads",
  "audiences",
  "charts",
  "commerce",
  "conversions",
  "insights",
  "instagram",
  "pages",
  "threads",
  "utility",
] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

const DEFAULT_TOOL_GROUPS: ToolGroup[] = ["ads", "insights", "threads"];

export interface ServerConfig {
  metaAccessToken: string;
  threadsAccessToken?: string;
  toolGroups: ReadonlySet<ToolGroup>;
  mcpServerUrl: URL;
  authIssuer: string;
  authJwksUrl: URL;
  allowedOrigins: string[];
  host: string;
  port: number;
}

function loadToolGroups(value: string | undefined): ReadonlySet<ToolGroup> {
  const configured = value?.trim();
  if (!configured) return new Set(DEFAULT_TOOL_GROUPS);
  if (configured.toLowerCase() === "all") return new Set(TOOL_GROUPS);

  const groups = configured.split(",").map((group) => group.trim().toLowerCase());
  const invalid = groups.filter((group) => !TOOL_GROUPS.includes(group as ToolGroup));
  if (invalid.length) {
    throw new Error(
      `Invalid META_TOOL_GROUPS value: ${invalid.join(", ")}. ` +
        `Choose from: ${TOOL_GROUPS.join(", ")}, or use "all".`
    );
  }

  return new Set(groups as ToolGroup[]);
}

export function loadConfig(): ServerConfig {
  const serverUrlValue = process.env.MCP_SERVER_URL?.trim();
  const authIssuer = process.env.MCP_AUTH_ISSUER?.trim();
  const jwksUrlValue = process.env.MCP_AUTH_JWKS_URL?.trim();
  if (!serverUrlValue || !authIssuer || !jwksUrlValue) {
    throw new Error("Set MCP_SERVER_URL, MCP_AUTH_ISSUER, and MCP_AUTH_JWKS_URL to run the self-hosted HTTP server.");
  }

  const mcpServerUrl = new URL(serverUrlValue);
  const authJwksUrl = new URL(jwksUrlValue);
  const issuerUrl = new URL(authIssuer);
  if (mcpServerUrl.pathname !== "/mcp" || mcpServerUrl.search || mcpServerUrl.hash) {
    throw new Error("MCP_SERVER_URL must be the public /mcp endpoint without query or fragment.");
  }
  if (mcpServerUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(mcpServerUrl.hostname)) {
    throw new Error("MCP_SERVER_URL must use HTTPS except for localhost development.");
  }
  if (authJwksUrl.protocol !== "https:") throw new Error("MCP_AUTH_JWKS_URL must use HTTPS.");
  if (issuerUrl.protocol !== "https:") throw new Error("MCP_AUTH_ISSUER must use HTTPS.");
  const port = Number(process.env.MCP_PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MCP_PORT must be a valid TCP port.");

  return {
    metaAccessToken: process.env.META_ACCESS_TOKEN?.trim() ?? "",
    threadsAccessToken: process.env.THREADS_ACCESS_TOKEN?.trim() || undefined,
    toolGroups: loadToolGroups(process.env.META_TOOL_GROUPS),
    mcpServerUrl,
    authIssuer,
    authJwksUrl,
    allowedOrigins: (process.env.MCP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    host: process.env.MCP_HOST?.trim() || "0.0.0.0",
    port,
  };
}
