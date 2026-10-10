import { registerCampaignTools } from "./campaigns.js";
import { registerAdDeliveryTools } from "./delivery.js";
import { registerCreativeTools } from "./creatives.js";
import { registerTargetingTools } from "./targeting.js";
import { registerPixelTools } from "./pixels.js";
import { registerSavedAudienceTools } from "./audiences-and-rules.js";
import { registerAdAccountAssetTools } from "./operations.js";
import { registerStudyAndLeadTools } from "./measurement.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaApiClient } from "../../services/api.js";

export function registerAdsTools(server: McpServer, client: MetaApiClient): void {
  registerCampaignTools(server, client);
  registerAdDeliveryTools(server, client);
  registerCreativeTools(server, client);
  registerTargetingTools(server, client);
  registerPixelTools(server, client);
  registerSavedAudienceTools(server, client);
  registerAdAccountAssetTools(server, client);
  registerStudyAndLeadTools(server, client);
}
