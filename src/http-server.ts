import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { OAuthError, OAuthErrorCode, createMcpHandler } from "@modelcontextprotocol/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { ServerConfig } from "./config.js";
import { MetaApiClient } from "./services/api.js";
import { createMetaToolsServer } from "./server.js";

function getResourceFromAudience(audience: string | string[], resourceUrl: URL): URL | undefined {
  const audiences = Array.isArray(audience) ? audience : [audience];
  return audiences.find((value) => value === resourceUrl.href) ? resourceUrl : undefined;
}

export function startHttpServer(config: ServerConfig): void {
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
        clientId: typeof payload.client_id === "string" ? payload.client_id : payload.sub,
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
  const client = new MetaApiClient(config.metaAccessToken, config.threadsAccessToken);
  app.get("/.well-known/oauth-protected-resource/mcp", (_request, response) => {
    response.json({
      resource: config.mcpServerUrl.href,
      authorization_servers: [config.authIssuer],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
    });
  });

  const handleMcp = toNodeHandler(
    createMcpHandler(() => createMetaToolsServer(config, client))
  );
  app.all("/mcp", authorize, (request, response) => {
    void handleMcp(request, response, request.body);
  });

  app.listen(config.port, config.host, () => {
    console.info(`meta-tools MCP listening at ${config.mcpServerUrl.href}`);
  });
}
