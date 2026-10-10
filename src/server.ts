import { McpServer } from "@modelcontextprotocol/server";
import type { ServerConfig } from "./config.js";
import { MetaApiClient } from "./services/api.js";
import { META_TOOLS_VERSION } from "./constants.js";
import { registerTools } from "./tools/index.js";
import type { MetaConnectionStore } from "./services/meta-connection-store.js";

export function createMetaToolsServer(
  config: ServerConfig,
  client = new MetaApiClient(config.metaAccessToken, config.threadsAccessToken, { graphAppSecret: config.metaAppSecret }),
  requestContext: { principalId?: string; connectionStore?: MetaConnectionStore } = {}
): McpServer {
  const server = new McpServer({ name: "meta-tools", version: META_TOOLS_VERSION });
  registerTools(server, client, config.toolGroups, {
    serverUrl: config.mcpServerUrl.href,
    authIssuer: config.authIssuer,
    ...requestContext,
    config,
  });

  return server;
}
