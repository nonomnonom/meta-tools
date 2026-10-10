import { McpServer } from "@modelcontextprotocol/server";
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
import type { ToolGroup } from "../config.js";
import type { MetaConnectionStore } from "../services/meta-connection-store.js";
import type { ServerConfig } from "../config.js";

export function registerTools(
  server: McpServer,
  client: MetaApiClient,
  groups: ReadonlySet<ToolGroup>,
  diagnostics: {
    serverUrl?: string;
    authIssuer?: string;
    principalId?: string;
    connectionStore?: MetaConnectionStore;
    config?: ServerConfig;
  } = {}
): void {
  registerAgenticCapabilities(server);
  if (groups.has("pages")) registerPageTools(server, client);
  if (groups.has("instagram")) registerInstagramTools(server, client);
  if (groups.has("ads")) registerAdsTools(server, client);
  if (groups.has("audiences")) registerAudiencesTools(server, client);
  if (groups.has("insights")) registerInsightsTools(server, client);
  if (groups.has("threads")) registerThreadsTools(server, client);
  if (groups.has("ad-library")) registerAdLibraryTools(server, client);
  if (groups.has("conversions")) registerConversionTools(server, client);
  if (groups.has("utility")) registerUtilityTools(server, client, { ...diagnostics, toolGroups: [...groups] });
  if (groups.has("charts")) registerChartTools(server);
  if (groups.has("commerce")) registerCommerceTools(server, client);
}
