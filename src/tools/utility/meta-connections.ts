import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ServerConfig } from "../../config.js";
import { MetaConnectionStore, type MetaProvider } from "../../services/meta-connection-store.js";
import { createAuthorizationUrl, createOAuthState } from "../../services/meta-oauth.js";

const THREADS_PERMISSIONS = [
  "threads_basic", "threads_content_publish", "threads_manage_insights", "threads_read_replies",
  "threads_manage_replies", "threads_manage_mentions", "threads_keyword_search", "threads_delete",
  "threads_location_tagging", "threads_profile_discovery",
] as const;

export function registerMetaConnectionTools(
  server: McpServer,
  subject: string,
  store: MetaConnectionStore,
  config: ServerConfig
): void {
  server.registerTool(
    "meta_connect_account",
    {
      title: "Connect a Meta Account",
      description: "Starts Meta's official OAuth authorization for the authenticated MCP user. Facebook Login for Business connects Pages, Instagram, and Ads; Threads uses a separate OAuth authorization. Returns a short-lived, single-use link. Never ask the user to paste an access token.",
      inputSchema: z.object({
        provider: z.enum(["graph", "threads"]).describe("Connect Facebook/Instagram/Ads through Facebook Login for Business, or connect Threads separately."),
        threads_permissions: z.array(z.enum(THREADS_PERMISSIONS)).min(1).max(10).default(["threads_basic"]),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ provider, threads_permissions }) => {
      const selectedProvider: MetaProvider = provider;
      if (selectedProvider === "graph" && (!config.metaAppId || !config.metaGraphLoginConfigId)) {
        return { content: [{ type: "text", text: "Facebook Login for Business is not configured. The server owner must set META_APP_ID, META_APP_SECRET, and META_GRAPH_LOGIN_CONFIG_ID." }], isError: true };
      }
      if (selectedProvider === "threads" && (!config.threadsAppId || !config.threadsAppSecret)) {
        return { content: [{ type: "text", text: "Threads OAuth is not configured. The server owner must set THREADS_APP_ID and THREADS_APP_SECRET." }], isError: true };
      }
      const scopes = selectedProvider === "graph" ? [] : [...new Set(["threads_basic", ...threads_permissions])];
      const state = createOAuthState();
      store.createAuthorizationState(state, { provider: selectedProvider, scopes, createdAt: Date.now() });
      const url = createAuthorizationUrl(selectedProvider, scopes, state, config);
      return {
        content: [{ type: "text", text: [
          `Open this one-time ${selectedProvider === "graph" ? "Meta business" : "Threads"} authorization link in your browser:`,
          "",
          `[Connect ${selectedProvider === "graph" ? "Meta business" : "Threads"} account](${url.href})`,
          "",
          "The link expires in 10 minutes and is one-time. After Meta returns a confirmation code, call meta_complete_connection from the MCP identity that should own this account connection.",
        ].join("\n") }],
      };
    }
  );

  server.registerTool(
    "meta_complete_connection",
    {
      title: "Complete Meta Account Connection",
      description: "Attaches a pending Meta OAuth grant to the authenticated MCP identity. The one-time code comes from the Meta OAuth callback page; completing it from this MCP identity prevents a forwarded OAuth link from attaching another person's account to the link creator.",
      inputSchema: z.object({ confirmation_code: z.string().regex(/^[A-F0-9]{12}$/) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ confirmation_code }) => {
      const pending = store.consumePendingConnection(confirmation_code);
      if (!pending) return { content: [{ type: "text", text: "Confirmation code is invalid, expired, or already used. Start the Meta connection again." }], isError: true };
      store.saveConnection(subject, pending.provider, pending.connection);
      return { content: [{ type: "text", text: `${pending.provider === "graph" ? "Meta business" : "Threads"} account ${pending.connection.username ?? pending.connection.accountId} connected to this MCP identity.` }] };
    }
  );

  server.registerTool(
    "meta_list_connections",
    {
      title: "List Connected Meta Accounts",
      description: "Lists Meta and Threads connections for the authenticated MCP user. It never returns tokens.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const connections = store.listConnections(subject).map(({ provider, connection, updatedAt }) => ({
        provider,
        account_id: connection.accountId,
        username: connection.username,
        permissions: connection.scopes,
        permission_source: provider === "graph" ? "granted" : "requested",
        expires_at: connection.expiresAt ? new Date(connection.expiresAt * 1000).toISOString() : null,
        expired: connection.expiresAt !== null && connection.expiresAt <= Math.floor(Date.now() / 1000),
        updated_at: new Date(updatedAt).toISOString(),
      }));
      return { content: [{ type: "text", text: JSON.stringify({ connections }, null, 2) }] };
    }
  );

  server.registerTool(
    "meta_disconnect_account",
    {
      title: "Disconnect a Meta Account",
      description: "Deletes the authenticated user's encrypted local Meta or Threads credentials and cached Page tokens. Remove the app in Meta Business Integrations as well if you want to revoke its authorization at Meta.",
      inputSchema: z.object({ provider: z.enum(["graph", "threads"]) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ provider }) => {
      store.deleteConnection(subject, provider);
      return { content: [{ type: "text", text: `${provider === "graph" ? "Meta business" : "Threads"} connection removed from this MCP server. To revoke access at Meta, also remove this app from your Meta Business Integrations.` }] };
    }
  );
}
