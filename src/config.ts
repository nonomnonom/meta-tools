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

export const DEFAULT_TOOL_GROUPS: ToolGroup[] = ["ads", "insights", "threads", "utility"];

export interface ServerConfig {
  metaAuthMode: "per-user" | "shared";
  metaAccessToken: string;
  threadsAccessToken?: string;
  metaAppId?: string;
  metaAppSecret?: string;
  metaGraphLoginConfigId?: string;
  threadsAppId?: string;
  threadsAppSecret?: string;
  tokenEncryptionKey?: Buffer;
  tokenDatabasePath: string;
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

  const metaAuthMode = process.env.META_AUTH_MODE?.trim().toLowerCase() || "per-user";
  if (metaAuthMode !== "per-user" && metaAuthMode !== "shared") {
    throw new Error('META_AUTH_MODE must be "per-user" or "shared".');
  }
  let tokenEncryptionKey: Buffer | undefined;
  if (metaAuthMode === "per-user") {
    const encodedKey = process.env.META_TOKEN_ENCRYPTION_KEY?.trim();
    if (!encodedKey) throw new Error("META_TOKEN_ENCRYPTION_KEY is required when META_AUTH_MODE=per-user (base64-encoded 32-byte key).");
    tokenEncryptionKey = Buffer.from(encodedKey, "base64");
    if (tokenEncryptionKey.length !== 32 || tokenEncryptionKey.toString("base64") !== encodedKey) {
      throw new Error("META_TOKEN_ENCRYPTION_KEY must be valid base64 encoding of exactly 32 random bytes.");
    }
  }
  const metaAppId = process.env.META_APP_ID?.trim() || undefined;
  const metaAppSecret = process.env.META_APP_SECRET?.trim() || undefined;
  const metaGraphLoginConfigId = process.env.META_GRAPH_LOGIN_CONFIG_ID?.trim() || undefined;
  const threadsAppId = process.env.THREADS_APP_ID?.trim() || undefined;
  const threadsAppSecret = process.env.THREADS_APP_SECRET?.trim() || undefined;
  if (metaAuthMode === "per-user" && (!!metaAppId !== !!metaAppSecret || !!metaAppId !== !!metaGraphLoginConfigId)) {
    throw new Error("Set META_APP_ID, META_APP_SECRET, and META_GRAPH_LOGIN_CONFIG_ID together to enable Facebook Login for Business.");
  }
  if (metaAuthMode === "per-user" && (!!threadsAppId !== !!threadsAppSecret)) {
    throw new Error("Set THREADS_APP_ID and THREADS_APP_SECRET together to enable Threads OAuth.");
  }

  return {
    metaAuthMode,
    metaAccessToken: process.env.META_ACCESS_TOKEN?.trim() ?? "",
    threadsAccessToken: process.env.THREADS_ACCESS_TOKEN?.trim() || undefined,
    metaAppId,
    metaAppSecret,
    metaGraphLoginConfigId,
    threadsAppId,
    threadsAppSecret,
    tokenEncryptionKey,
    tokenDatabasePath: process.env.META_TOKEN_DATABASE_PATH?.trim() || "./data/meta-tools.sqlite",
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
