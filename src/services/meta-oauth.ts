import axios from "axios";
import { randomBytes } from "node:crypto";
import type { ServerConfig } from "../config.js";
import type { MetaProvider, MetaConnectionStore, StoredMetaConnection } from "./meta-connection-store.js";

const THREADS_SCOPES = new Set([
  "threads_basic", "threads_content_publish", "threads_manage_insights", "threads_read_replies",
  "threads_manage_replies", "threads_manage_mentions", "threads_keyword_search", "threads_delete",
  "threads_location_tagging", "threads_profile_discovery",
]);
const GRAPH_BASE = "https://graph.facebook.com/v26.0";
const THREADS_BASE = "https://graph.threads.net/v1.0";
const THREADS_OAUTH_BASE = "https://graph.threads.net";

export function callbackUrl(config: ServerConfig): URL {
  return new URL("/oauth/meta/callback", config.mcpServerUrl.origin);
}

export function createAuthorizationUrl(
  provider: MetaProvider,
  scopes: string[],
  state: string,
  config: ServerConfig
): URL {
  const redirectUri = callbackUrl(config).href;
  if (provider === "graph") {
    if (!config.metaAppId || !config.metaGraphLoginConfigId) throw new Error("Facebook Login for Business is not configured on this server.");
    const url = new URL("https://www.facebook.com/v26.0/dialog/oauth");
    url.searchParams.set("client_id", config.metaAppId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("config_id", config.metaGraphLoginConfigId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    return url;
  }

  if (!config.threadsAppId) throw new Error("Threads OAuth is not configured on this server.");
  if (!scopes.length || scopes.some((scope) => !THREADS_SCOPES.has(scope))) throw new Error("One or more Threads permissions are not supported.");
  const url = new URL("https://threads.net/oauth/authorize");
  url.searchParams.set("client_id", config.threadsAppId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url;
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export async function completeAuthorization(
  provider: MetaProvider,
  code: string,
  scopes: string[],
  config: ServerConfig
): Promise<StoredMetaConnection> {
  return provider === "graph"
    ? completeGraphAuthorization(code, scopes, config)
    : completeThreadsAuthorization(code, scopes, config);
}

const threadsRefreshes = new Map<string, Promise<StoredMetaConnection>>();

export async function getUsableConnection(
  store: MetaConnectionStore,
  subject: string,
  provider: MetaProvider,
  config: ServerConfig
): Promise<StoredMetaConnection | undefined> {
  const current = store.getConnection(subject, provider);
  if (!current || provider !== "threads" || !current.expiresAt || current.expiresAt - Math.floor(Date.now() / 1000) > 7 * 24 * 60 * 60) return current;
  if (current.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("Threads access expired. Call meta_connect_account with provider=threads to reconnect.");
  if (!config.threadsAppSecret) throw new Error("THREADS_APP_SECRET is required to refresh this connection. Restore the app secret or reconnect Threads.");
  const key = `${subject}:threads`;
  let refresh = threadsRefreshes.get(key);
  if (!refresh) {
    refresh = axios.get<{ access_token: string; expires_in: number }>(`${THREADS_OAUTH_BASE}/refresh_access_token`, {
      params: { grant_type: "th_refresh_token", access_token: current.accessToken }, timeout: 15000,
    }).then(({ data }) => {
      const updated = { ...current, accessToken: data.access_token, expiresAt: Math.floor(Date.now() / 1000) + data.expires_in };
      store.saveConnection(subject, provider, updated);
      return updated;
    }).catch(() => {
      throw new Error("Threads token refresh failed. Reconnect with meta_connect_account provider=threads.");
    }).finally(() => threadsRefreshes.delete(key));
    threadsRefreshes.set(key, refresh);
  }
  return refresh;
}

export async function handleOAuthCallback(
  query: { state?: unknown; code?: unknown; error?: unknown },
  store: MetaConnectionStore,
  config: ServerConfig
): Promise<{ status: number; message: string }> {
  if (typeof query.state !== "string" || query.state.length < 40 || query.state.length > 100) {
    return { status: 400, message: "The authorization link is invalid or expired. Start the connection again from your MCP client." };
  }
  const pending = store.consumeAuthorizationState(query.state);
  if (!pending) return { status: 400, message: "The authorization link is invalid, expired, or already used. Start the connection again from your MCP client." };
  if (query.error || typeof query.code !== "string" || query.code.length > 4096) {
    return { status: 400, message: "Meta authorization was cancelled or could not be completed. Start again if you want to connect." };
  }
  try {
    const connection = await completeAuthorization(pending.provider, query.code, pending.scopes, config);
    const confirmationCode = randomBytes(6).toString("hex").toUpperCase();
    store.createPendingConnection(confirmationCode, pending.provider, connection);
    return {
      status: 200,
      message: `Authorization succeeded. Your one-time confirmation code is: ${confirmationCode}. Call meta_complete_connection from the MCP identity that should own this account connection. The code expires in 10 minutes.`,
    };
  } catch {
    return { status: 502, message: "Meta did not complete the connection. Check the app configuration and permissions, then start again." };
  }
}

async function completeGraphAuthorization(code: string, scopes: string[], config: ServerConfig): Promise<StoredMetaConnection> {
  if (!config.metaAppId || !config.metaAppSecret) throw new Error("Facebook Login for Business is not configured.");
  const redirect_uri = callbackUrl(config).href;
  const shortToken = await axios.get<{ access_token: string; expires_in?: number }>(`${GRAPH_BASE}/oauth/access_token`, {
    params: { client_id: config.metaAppId, client_secret: config.metaAppSecret, redirect_uri, code }, timeout: 15000,
  });
  const longToken = await axios.get<{ access_token: string; expires_in?: number }>(`${GRAPH_BASE}/oauth/access_token`, {
    params: { grant_type: "fb_exchange_token", client_id: config.metaAppId, client_secret: config.metaAppSecret, fb_exchange_token: shortToken.data.access_token }, timeout: 15000,
  });
  const profile = await axios.get<{ id: string; name?: string }>(`${GRAPH_BASE}/me`, {
    params: { fields: "id,name", access_token: longToken.data.access_token }, timeout: 15000,
  });
  const permissions = await axios.get<{ data: Array<{ permission: string; status: string }> }>(`${GRAPH_BASE}/me/permissions`, {
    params: { access_token: longToken.data.access_token }, timeout: 15000,
  });
  if (!profile.data.id) throw new Error("Meta did not return the connected user ID.");
  return {
    accessToken: longToken.data.access_token,
    expiresAt: longToken.data.expires_in ? Math.floor(Date.now() / 1000) + longToken.data.expires_in : null,
    scopes: permissions.data.data.filter((permission) => permission.status === "granted").map((permission) => permission.permission),
    accountId: profile.data.id,
    username: profile.data.name,
  };
}

async function completeThreadsAuthorization(code: string, scopes: string[], config: ServerConfig): Promise<StoredMetaConnection> {
  if (!config.threadsAppId || !config.threadsAppSecret) throw new Error("Threads OAuth is not configured.");
  const redirect_uri = callbackUrl(config).href;
  const shortToken = await axios.post<{ access_token: string; user_id: string }>(
    "https://graph.threads.net/oauth/access_token",
    new URLSearchParams({ client_id: config.threadsAppId, client_secret: config.threadsAppSecret, code, grant_type: "authorization_code", redirect_uri }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 }
  );
  const longToken = await axios.get<{ access_token: string; expires_in: number }>(`${THREADS_OAUTH_BASE}/access_token`, {
    params: { grant_type: "th_exchange_token", client_secret: config.threadsAppSecret, access_token: shortToken.data.access_token }, timeout: 15000,
  });
  const profile = await axios.get<{ id: string; username?: string }>(`${THREADS_BASE}/me`, {
    params: { fields: "id,username", access_token: longToken.data.access_token }, timeout: 15000,
  });
  const accountId = profile.data.id || shortToken.data.user_id;
  if (!accountId) throw new Error("Threads did not return the connected user ID.");
  return {
    accessToken: longToken.data.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + longToken.data.expires_in,
    scopes,
    accountId,
    username: profile.data.username,
  };
}
