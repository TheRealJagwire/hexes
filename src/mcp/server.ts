import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HexService } from "../server/core/service.ts";
import { Workspace } from "../server/core/workspace.ts";
import { buildServer } from "./build.ts";

// stdout belongs to the MCP transport; anything human-readable must go to stderr.
const service = new HexService(Workspace.fromEnv());
await buildServer(service).connect(new StdioServerTransport());
console.error("hexes MCP server ready (stdio)");
