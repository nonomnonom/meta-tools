import axios from "axios";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaApiClient } from "../../src/services/api.js";
import { registerDiagnosticTools } from "../../src/tools/utility/diagnostics.js";

function setup(client = new MetaApiClient("test-meta-token")) {
  const tools = new Map<string, { schema: any; handler: (args: any) => Promise<any> }>();
  const server = {
    registerTool(name: string, schema: any, handler: (args: any) => Promise<any>) {
      tools.set(name, { schema, handler });
    },
  } as unknown as McpServer;
  registerDiagnosticTools(server, client, {
    serverUrl: "https://mcp.example.test/mcp",
    authIssuer: "https://identity.example.test/",
    toolGroups: ["utility", "threads"],
  });
  return {
    client,
    tools,
    call: async (name: string, input: Record<string, unknown> = {}) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Unknown test tool: ${name}`);
      return tool.handler(tool.schema.inputSchema.parse(input));
    },
  };
}

describe("MCP runtime diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports useful runtime state without exposing configured tokens", async () => {
    const { call } = setup();
    const response = await call("meta_server_diagnostics", { response_format: "json" });
    const text = response.content[0].text as string;
    const result = JSON.parse(text);
    expect(result).toMatchObject({
      status: "running",
      server: { endpoint: "https://mcp.example.test/mcp", authorization_issuer: "https://identity.example.test/" },
      credentials: { meta_access_token: true, threads_access_token: false, page_tokens_cached: 0 },
      tool_groups: ["threads", "utility"],
    });
    expect(text).not.toContain("test-meta-token");
  });

  it("explains common Meta auth and permission errors with next steps", async () => {
    const { call } = setup();
    const invalidToken = await call("meta_diagnose_api_error", { error_code: 190, response_format: "json" });
    expect(JSON.parse(invalidToken.content[0].text)).toMatchObject({
      summary: "The access token is invalid, expired, or no longer accepted.",
      next_step: expect.stringContaining("meta_debug_token"),
    });

    const permission = await call("meta_diagnose_api_error", { error_code: 200, http_status: 403, response_format: "json" });
    expect(JSON.parse(permission.content[0].text).summary).toContain("missing permission");
  });

  it("classifies live API failures and omits token values", async () => {
    const client = new MetaApiClient("test-meta-token");
    const apiError = Object.assign(new Error("token must not appear in diagnostics"), {
      isAxiosError: true,
      response: { status: 400, data: { error: { code: 190, error_subcode: 463 } } },
    });
    vi.spyOn(axios, "get").mockRejectedValue(apiError);
    const { call } = setup(client);
    const response = await call("meta_check_api_connections", { apis: ["graph"], response_format: "json" });
    const text = response.content[0].text as string;
    expect(JSON.parse(text)).toMatchObject({
      status: "unhealthy",
      checks: [{ service: "Graph API", status: "error", error_code: 190, error_subcode: 463 }],
    });
    expect(text).not.toContain("test-meta-token");
    expect(text).not.toContain("token must not appear");
  });
});
