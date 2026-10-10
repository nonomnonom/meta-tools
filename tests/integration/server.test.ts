import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerConfig } from "../../src/config.js";
import { createHttpApp } from "../../src/http-server.js";

const issuer = "https://identity.example.test/";
const signingKeyId = "meta-tools-integration";
let serverUrl: URL;
let appServer: HttpServer;
let jwksServer: HttpServer;
let signingKey: CryptoKey;

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

async function makeAccessToken(scopes = "mcp"): Promise<string> {
  return new SignJWT({ scope: scopes })
    .setProtectedHeader({ alg: "RS256", kid: signingKeyId })
    .setIssuer(issuer)
    .setAudience(serverUrl.href)
    .setSubject("integration-test-user")
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(signingKey);
}

describe("remote Streamable HTTP MCP server", () => {
  beforeAll(async () => {
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
      metaAccessToken: "",
      toolGroups: new Set(["utility"]),
      mcpServerUrl: serverUrl,
      authIssuer: issuer,
      authJwksUrl: new URL(`http://127.0.0.1:${jwksPort}/jwks`),
      allowedOrigins: [],
      host: "127.0.0.1",
      port: appPort,
    };
    appServer = createHttpApp(config).listen(appPort, "127.0.0.1");
    await new Promise<void>((resolve) => appServer.once("listening", resolve));
  });

  afterAll(async () => {
    await Promise.all([close(appServer), close(jwksServer)]);
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
