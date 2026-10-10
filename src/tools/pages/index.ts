import { registerPagePostTools } from "./posts.js";
import { registerPageMessagingTools } from "./messaging.js";
import { registerPageInsightsTools } from "./insights.js";
import { registerPageCommentTools } from "./engagement.js";
import { registerPageMediaTools } from "./content.js";
import { registerPageModerationTools } from "./moderation.js";
import { registerPageSettingsTools } from "./resources.js";
import { registerPageStoryTools } from "./publishing.js";
import { McpServer } from "@modelcontextprotocol/server";
import { MetaApiClient } from "../../services/api.js";

export function registerPageTools(server: McpServer, client: MetaApiClient): void {
  registerPagePostTools(server, client);
  registerPageMessagingTools(server, client);
  registerPageInsightsTools(server, client);
  registerPageCommentTools(server, client);
  registerPageMediaTools(server, client);
  registerPageModerationTools(server, client);
  registerPageSettingsTools(server, client);
  registerPageStoryTools(server, client);
}
