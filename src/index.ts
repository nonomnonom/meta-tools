#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { startHttpServer } from "./http-server.js";

startHttpServer(loadConfig());
