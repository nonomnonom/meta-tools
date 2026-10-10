import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import express from "express";
import { OAuthError, OAuthErrorCode, createMcpHandler } from "@modelcontextprotocol/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { ServerConfig } from "./config.js";
import { MetaApiClient } from "./services/api.js";
import { MetaConnectionStore } from "./services/meta-connection-store.js";
import { getUsableConnection, handleOAuthCallback } from "./services/meta-oauth.js";
import { verifyMetaSignedRequest } from "./services/meta-signed-request.js";
import { createMetaToolsServer } from "./server.js";

function getResourceFromAudience(audience: string | string[], resourceUrl: URL): URL | undefined {
  const audiences = Array.isArray(audience) ? audience : [audience];
  return audiences.find((value) => value === resourceUrl.href) ? resourceUrl : undefined;
}

export function createHttpApp(config: ServerConfig) {
  const jwks = createRemoteJWKSet(config.authJwksUrl);
  const verifier = {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, jwks, {
          issuer: config.authIssuer,
          audience: config.mcpServerUrl.href,
        }));
      } catch {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token is invalid or expired.");
      }
      if (typeof payload.exp !== "number" || typeof payload.sub !== "string") {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token must include exp and sub claims.");
      }
      const rawScopes = payload.scope ?? payload.scopes;
      const scopes = Array.isArray(rawScopes)
        ? rawScopes.filter((scope): scope is string => typeof scope === "string")
        : typeof rawScopes === "string"
          ? rawScopes.split(/\s+/).filter(Boolean)
          : [];
      const resource = getResourceFromAudience(payload.aud ?? [], config.mcpServerUrl);
      if (!resource) throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token audience does not match this MCP server.");

      return {
        token,
        // The external IdP subject is the Meta credential owner. client_id identifies
        // the OAuth client application and must not be used as a tenant key.
        clientId: payload.sub,
        scopes,
        expiresAt: payload.exp,
        resource,
      };
    },
  };
  const resourceMetadataUrl = new URL(
    `/.well-known/oauth-protected-resource${config.mcpServerUrl.pathname}`,
    config.mcpServerUrl.origin
  ).href;
  const authorize = requireBearerAuth({
    verifier,
    expectedResource: config.mcpServerUrl,
    requiredScopes: ["mcp"],
    resourceMetadataUrl,
  });

  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: [config.mcpServerUrl.hostname],
    allowedOrigins: config.allowedOrigins,
  });
  // MCP servers are created per HTTP request; share this process-scoped client
  // so Page token cache and refresh coordination survive between tool calls.
  const connectionStore = config.metaAuthMode === "per-user"
    ? new MetaConnectionStore(config.tokenDatabasePath, config.tokenEncryptionKey!)
    : undefined;
  const sharedClient = config.metaAuthMode === "shared"
    ? new MetaApiClient(config.metaAccessToken, config.threadsAccessToken, { graphAppSecret: config.metaAppSecret })
    : undefined;
  app.get("/.well-known/oauth-protected-resource/mcp", (_request, response) => {
    response.json({
      resource: config.mcpServerUrl.href,
      authorization_servers: [config.authIssuer],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
    });
  });

  if (connectionStore) {
    app.get("/oauth/meta/data-deletion", (_request, response) => {
      response
        .status(200)
        .set({ "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" })
        .type("html")
        .send("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Meta data deletion</title><body><main><h1>Meta data deletion</h1><p>To remove a connected Meta or Threads account from this MCP server, call the meta_disconnect_account tool for the relevant provider. This deletes the encrypted access token and cached Page tokens stored by this server. To revoke the app permission at Meta, also remove the app from Meta Business Integrations.</p><p>To request deletion from the deployment operator, contact the operator of the MCP server URL you use.</p></main></body></html>");
    });
    app.get("/oauth/meta/callback", async (request, response) => {
      const result = await handleOAuthCallback(request.query, connectionStore, config);
      response
        .status(result.status)
        .set({
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        })
        .type("html")
        .send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Meta account connection</title><body><main><h1>Meta account connection</h1><p>${escapeHtml(result.message)}</p></main></body></html>`);
    });
    const parseMetaForm = express.urlencoded({ extended: false, limit: "8kb" });
    app.post("/oauth/meta/deauthorize/:provider", parseMetaForm, (request, response) => {
      const provider = parseMetaProvider(request.params.provider);
      const appSecret = provider === "graph" ? config.metaAppSecret : provider === "threads" ? config.threadsAppSecret : undefined;
      const payload = verifyMetaSignedRequest(request.body?.signed_request, appSecret ?? "");
      if (!provider || !appSecret) return response.status(503).send("Meta deauthorization callback is not configured.");
      if (!payload) return response.status(400).send("Invalid Meta signed request.");
      connectionStore.deleteMetaUserConnections(provider, payload.user_id);
      return response.status(200).type("text").send("ok");
    });
    app.post("/oauth/meta/data-deletion/:provider", parseMetaForm, (request, response) => {
      const provider = parseMetaProvider(request.params.provider);
      const appSecret = provider === "graph" ? config.metaAppSecret : provider === "threads" ? config.threadsAppSecret : undefined;
      const payload = verifyMetaSignedRequest(request.body?.signed_request, appSecret ?? "");
      if (!provider || !appSecret) return response.status(503).json({ error: "Meta data deletion callback is not configured." });
      if (!payload) return response.status(400).json({ error: "Invalid Meta signed request." });
      const confirmationCode = randomBytes(24).toString("hex").toUpperCase();
      connectionStore.completeMetaUserDataDeletion(provider, payload.user_id, confirmationCode);
      const statusUrl = new URL("/oauth/meta/data-deletion/status", config.mcpServerUrl.origin);
      statusUrl.searchParams.set("code", confirmationCode);
      return response.status(200).json({ url: statusUrl.href, confirmation_code: confirmationCode });
    });
    app.get("/oauth/meta/data-deletion/status", (request, response) => {
      const code = request.query.code;
      if (typeof code !== "string" || !/^[A-F0-9]{48}$/.test(code)) return response.status(400).json({ error: "A valid confirmation code is required." });
      const status = connectionStore.getDataDeletionStatus(code);
      if (!status) return response.status(404).json({ error: "Deletion request not found." });
      return response.status(200).json({ confirmation_code: code, status: status.status, completed_at: new Date(status.createdAt).toISOString() });
    });
    app.locals.closeMetaConnectionStore = () => connectionStore.close();
  }

  const handleMcp = toNodeHandler(createMcpHandler(async (context) => {
    if (!connectionStore) return createMetaToolsServer(config, sharedClient);
    const subject = context.authInfo?.clientId;
    if (!subject) throw new Error("Authenticated MCP identity is required for per-user Meta connections.");
    const graph = connectionStore.getConnection(subject, "graph");
    const threads = connectionStore.getConnection(subject, "threads");
    const client = new MetaApiClient(
      graph?.accessToken ?? "",
      threads?.accessToken,
      {
        pageTokens: connectionStore.getPageTokens(subject),
        onPageTokenCached: (pageId, token) => connectionStore.savePageToken(subject, pageId, token),
        coordinatePageTokenRefresh: connectionStore.coordinatePageTokenRefresh(subject),
        graphAppSecret: config.metaAppSecret,
        resolveThreadsToken: async () => {
          const active = await getUsableConnection(connectionStore, subject, "threads", config);
          if (!active) throw new Error("No Threads account connected. Call meta_connect_account with provider=threads.");
          return active.accessToken;
        },
      }
    );
    return createMetaToolsServer(config, client, { principalId: subject, connectionStore });
  }));
  app.all("/mcp", authorize, (request, response) => {
    void handleMcp(request, response, request.body);
  });

  return app;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function parseMetaProvider(value: string): "graph" | "threads" | undefined {
  return value === "graph" || value === "threads" ? value : undefined;
}

export function startHttpServer(config: ServerConfig): void {
  const app = createHttpApp(config);
  const httpServer = app.listen(config.port, config.host, () => {
    console.info(`meta-tools MCP listening at ${config.mcpServerUrl.href}`);
  });
  httpServer.once("close", () => app.locals.closeMetaConnectionStore?.());
}
