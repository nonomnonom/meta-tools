import { McpServer } from "@modelcontextprotocol/server";
import type { ServerConfig } from "./config.js";
import { MetaApiClient } from "./services/api.js";
import { registerTools } from "./tools/index.js";

export function createMetaToolsServer(config: ServerConfig, client = new MetaApiClient(config.metaAccessToken, config.threadsAccessToken)): McpServer {
  const server = new McpServer({ name: "meta-tools", version: "1.0.0" });
  registerTools(server, client, config.toolGroups);

  return server;
}
