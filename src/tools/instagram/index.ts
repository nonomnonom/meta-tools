import { registerInstagramPublishingTools } from "./publishing.js";
import { registerInstagramInsightsTools } from "./insights.js";
import { registerInstagramDiscoveryTools } from "./community.js";
import { registerInstagramCommentTools } from "./moderation.js";
import { registerInstagramMediaTools } from "./media.js";
import { registerInstagramDirectMessageTools } from "./direct-messaging.js";
import { registerInstagramBroadcastTools } from "./broadcast.js";
import { registerInstagramCommerceTools } from "./catalog.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaApiClient } from "../../services/api.js";

export function registerInstagramTools(server: McpServer, client: MetaApiClient): void {
  registerInstagramPublishingTools(server, client);
  registerInstagramInsightsTools(server, client);
  registerInstagramDiscoveryTools(server, client);
  registerInstagramCommentTools(server, client);
  registerInstagramMediaTools(server, client);
  registerInstagramDirectMessageTools(server, client);
  registerInstagramBroadcastTools(server, client);
  registerInstagramCommerceTools(server, client);
}



\n