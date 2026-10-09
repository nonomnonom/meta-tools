import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaApiClient } from "../services/api.js";
import { registerAdLibraryTools } from "./ad-library/index.js";
import { registerAdsTools } from "./ads/index.js";
import { registerAudiencesTools } from "./audiences/index.js";
import { registerChartTools } from "./charts/index.js";
import { registerCommerceTools } from "./commerce/index.js";
import { registerConversionTools } from "./conversions/index.js";
import { registerInsightsTools } from "./insights/index.js";
import { registerInstagramTools } from "./instagram/index.js";
import { registerPageTools } from "./pages/index.js";
import { registerThreadsTools } from "./threads/index.js";
import { registerUtilityTools } from "./utility/index.js";
import { registerAgenticCapabilities } from "./agent-workflow/index.js";

export function registerTools(server: McpServer, client: MetaApiClient): void {
  registerAgenticCapabilities(server);
  registerPageTools(server, client);
  registerInstagramTools(server, client);
  registerAdsTools(server, client);
  registerAudiencesTools(server, client);
  registerInsightsTools(server, client);
  registerThreadsTools(server, client);
  registerAdLibraryTools(server, client);
  registerConversionTools(server, client);
  registerUtilityTools(server, client);
  registerChartTools(server);
  registerCommerceTools(server, client);
}
