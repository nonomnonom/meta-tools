import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "./config.js";
import { MetaApiClient } from "./services/api.js";
import { registerTools } from "./tools/index.js";

export function createMetaToolsServer(config: ServerConfig): McpServer {
  const server = new McpServer({ name: "meta-tools", version: "1.0.0" });
  const client = new MetaApiClient(config.metaAccessToken, config.threadsAccessToken);
  registerTools(server, client);

  return server;
}
