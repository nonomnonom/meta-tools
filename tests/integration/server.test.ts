import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import axios from "axios";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../../src/config.js";
import { createHttpApp } from "../../src/http-server.js";

const issuer = "https://identity.example.test/";
const signingKeyId = "meta-tools-integration";
let serverUrl: URL;
let appServer: HttpServer;
let jwksServer: HttpServer;
let signingKey: CryptoKey;
let tokenDatabasePath: string;
let app: ReturnType<typeof createHttpApp>;

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function makeAccessToken(scopes = "mcp", subject = "integration-test-user"): Promise<string> {
  return new SignJWT({ scope: scopes })
    .setProtectedHeader({ alg: "RS256", kid: signingKeyId })
    .setIssuer(issuer)
    .setAudience(serverUrl.href)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(signingKey);
}

function signedMetaRequest(userId: string, appSecret: string): string {
  const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: userId })).toString("base64url");
  const signature = createHmac("sha256", appSecret).update(payload).digest("base64url");
  return `${signature}.${payload}`;
}

describe("remote Streamable HTTP MCP server", () => {
  beforeAll(async () => {
    tokenDatabasePath = join(mkdtempSync(join(tmpdir(), "meta-tools-mcp-test-")), "connections.sqlite");
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    signingKey = privateKey;
    const publicJwk = { ...(await exportJWK(publicKey)), use: "sig", alg: "RS256", kid: signingKeyId };
    jwksServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    const jwksPort = await listen(jwksServer);
    const appPort = await new Promise<number>((resolve, reject) => {
      const reservation = createServer();
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", () => {
        const port = (reservation.address() as AddressInfo).port;
        reservation.close((error) => error ? reject(error) : resolve(port));
      });
    });
    serverUrl = new URL(`http://127.0.0.1:${appPort}/mcp`);
    const config: ServerConfig = {
      metaAuthMode: "per-user",
      metaAccessToken: "",
      metaAppId: "facebook-app-id",
      metaAppSecret: "facebook-app-secret",
      metaGraphLoginConfigId: "business-login-config",
      threadsAppId: "threads-app-id",
      threadsAppSecret: "threads-app-secret",
      tokenEncryptionKey: randomBytes(32),
      tokenDatabasePath,
      toolGroups: new Set(["utility"]),
      mcpServerUrl: serverUrl,
      authIssuer: issuer,
      authJwksUrl: new URL(`http://127.0.0.1:${jwksPort}/jwks`),
      allowedOrigins: [],
      host: "127.0.0.1",
      port: appPort,
    };
    app = createHttpApp(config);
    appServer = app.listen(appPort, "127.0.0.1");
    await new Promise<void>((resolve) => appServer.once("listening", resolve));
  });

  afterAll(async () => {
    await Promise.all([close(appServer), close(jwksServer)]);
    app.locals.closeMetaConnectionStore();
    rmSync(dirname(tokenDatabasePath), { recursive: true, force: true });
  });

  it("challenges unauthenticated MCP requests with protected-resource metadata", async () => {
    const response = await fetch(serverUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("serves metadata without exposing credentials", async () => {
    const metadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", serverUrl);
    const response = await fetch(metadataUrl);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resource: serverUrl.href,
      authorization_servers: [issuer],
      scopes_supported: ["mcp"],
    });
  });

  it("connects through an MCP client and exposes useful runtime diagnostics", async () => {
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(serverUrl, {
      authProvider: { token: async () => makeAccessToken() },
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const toolNames = listed.tools.map((tool) => tool.name);
      expect(toolNames).toContain("meta_server_diagnostics");
      expect(toolNames).toContain("meta_debug_token");
      expect(toolNames).toContain("meta_connect_account");

      const diagnostics = await client.callTool({ name: "meta_server_diagnostics", arguments: { response_format: "json" } });
      expect(diagnostics.isError).not.toBe(true);
      const result = JSON.parse(String(diagnostics.content[0]?.text));
      expect(result).toMatchObject({ status: "running", credentials: { meta_access_token: false } });

      const connections = await client.callTool({ name: "meta_check_api_connections", arguments: { response_format: "json" } });
      const checks = JSON.parse(String(connections.content[0]?.text));
      expect(checks.status).toBe("degraded");
      expect(checks.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ service: "Graph API", status: "skipped" }),
        expect.objectContaining({ service: "Threads API", status: "skipped" }),
      ]));
    } finally {
      await client.close();
    }
  });

  it("binds OAuth state and encrypted Meta credentials to the authenticated MCP subject", async () => {
    const openClient = async (subject: string) => {
      const client = new Client({ name: `integration-${subject}`, version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(serverUrl, {
        authProvider: { token: async () => makeAccessToken("mcp", subject) },
      }));
      return client;
    };
    const firstUser = await openClient("business-owner-a");
    const secondUser = await openClient("business-owner-b");
    const apiGet = vi.spyOn(axios, "get");
    apiGet
      .mockResolvedValueOnce({ data: { access_token: "short-lived-meta-token", expires_in: 3600 } } as never)
      .mockResolvedValueOnce({ data: { access_token: "long-lived-meta-token", expires_in: 3600 } } as never)
      .mockResolvedValueOnce({ data: { id: "123456789", name: "Business A" } } as never);
    apiGet.mockResolvedValueOnce({ data: { data: [{ permission: "pages_show_list", status: "granted" }] } } as never);
    try {
      const threadsStarted = await secondUser.callTool({
        name: "meta_connect_account",
        arguments: { provider: "threads", threads_permissions: ["threads_basic", "threads_content_publish"] },
      });
      const threadsLink = String(threadsStarted.content[0]?.text).match(/\(https:\/\/[^)]+\)/)?.[0].slice(1, -1);
      expect(threadsLink).toBeDefined();
      const threadsAuthorizationUrl = new URL(threadsLink!);
      expect(threadsAuthorizationUrl.origin).toBe("https://threads.net");
      expect(threadsAuthorizationUrl.searchParams.get("scope")).toBe("threads_basic,threads_content_publish");

      const started = await firstUser.callTool({ name: "meta_connect_account", arguments: { provider: "graph" } });
      const text = String(started.content[0]?.text);
      const link = text.match(/\(https:\/\/[^)]+\)/)?.[0].slice(1, -1);
      expect(link).toBeDefined();
      const authorizationUrl = new URL(link!);
      expect(authorizationUrl.origin).toBe("https://www.facebook.com");
      expect(authorizationUrl.searchParams.get("config_id")).toBe("business-login-config");
      const callbackUrl = new URL("/oauth/meta/callback", serverUrl.origin);
      callbackUrl.searchParams.set("state", authorizationUrl.searchParams.get("state")!);
      callbackUrl.searchParams.set("code", "one-time-meta-code");
      const callback = await fetch(callbackUrl);
      expect(callback.status).toBe(200);
      const callbackText = await callback.text();
      const confirmationCode = callbackText.match(/confirmation code is: ([A-F0-9]{12})/)?.[1];
      expect(confirmationCode).toBeDefined();

      const completed = await firstUser.callTool({ name: "meta_complete_connection", arguments: { confirmation_code: confirmationCode } });
      expect(String(completed.content[0]?.text)).toContain("connected to this MCP identity");

      const firstConnections = await firstUser.callTool({ name: "meta_list_connections", arguments: {} });
      const firstText = String(firstConnections.content[0]?.text);
      expect(firstText).toContain("123456789");
      expect(firstText).toContain("pages_show_list");
      expect(firstText).not.toContain("long-lived-meta-token");
      const secondConnections = await secondUser.callTool({ name: "meta_list_connections", arguments: {} });
      expect(String(secondConnections.content[0]?.text)).not.toContain("123456789");
      const replayedCode = await secondUser.callTool({ name: "meta_complete_connection", arguments: { confirmation_code: confirmationCode } });
      expect(replayedCode.isError).toBe(true);
      expect(await fetch(callbackUrl).then((response) => response.status)).toBe(400);

      const deletionUrl = new URL("/oauth/meta/data-deletion/graph", serverUrl.origin);
      const invalidSignedRequest = await fetch(deletionUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ signed_request: signedMetaRequest("123456789", "wrong-secret") }),
      });
      expect(invalidSignedRequest.status).toBe(400);
      expect(String((await firstUser.callTool({ name: "meta_list_connections", arguments: {} })).content[0]?.text)).toContain("123456789");

      const deletion = await fetch(deletionUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ signed_request: signedMetaRequest("123456789", "facebook-app-secret") }),
      });
      expect(deletion.status).toBe(200);
      const deletionRecord = await deletion.json() as { url: string; confirmation_code: string };
      expect(deletionRecord.url).toContain("/oauth/meta/data-deletion/status?code=");
      const deletionStatus = await fetch(deletionRecord.url);
      await expect(deletionStatus.json()).resolves.toMatchObject({ confirmation_code: deletionRecord.confirmation_code, status: "completed" });
      expect(String((await firstUser.callTool({ name: "meta_list_connections", arguments: {} })).content[0]?.text)).not.toContain("123456789");
    } finally {
      apiGet.mockRestore();
      await Promise.all([firstUser.close(), secondUser.close()]);
    }
  });

  it("rejects a valid token that lacks the MCP scope", async () => {
    const response = await fetch(serverUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await makeAccessToken("profile")}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(403);
  });
});
