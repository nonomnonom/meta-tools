import { registerThreadsPublishingTools } from "./publishing.js";
import { registerThreadsReplyAndInsightTools } from "./engagement.js";
import { registerThreadsDiscoveryTools } from "./discovery.js";
import { registerThreadsExtendedPublishingTools } from "./publishing-and-audience.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaApiClient } from "../../services/api.js";

export function registerThreadsTools(server: McpServer, client: MetaApiClient): void {
  registerThreadsPublishingTools(server, client);
  registerThreadsReplyAndInsightTools(server, client);
  registerThreadsDiscoveryTools(server, client);
  registerThreadsExtendedPublishingTools(server, client);
}




\n