#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMetaToolsServer } from "./server.js";
import { loadConfig } from "./config.js";

const transport = new StdioServerTransport();
await createMetaToolsServer(loadConfig()).connect(transport);
