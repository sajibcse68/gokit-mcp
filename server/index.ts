import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { fetchIncidents } from "./politiet.js";
import type { IncidentsPayload } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "dist");
const DASHBOARD_URI = "ui://politiloggen/dashboard.html";

function createMcpServer() {
  const server = new McpServer({ name: "police-dashboard", version: "1.0.0" });

  registerAppTool(
    server,
    "get_incidents",
    {
      title: "Get Police Incidents",
      description:
        "Fetch recent incidents from the Norwegian Police (Politiet) Politiloggen feed and render them " +
        "in an interactive dashboard with category filtering and stats.",
      inputSchema: {
        category: z.string().optional().describe("Filter to a single category name (e.g. 'Trafikkuhell'). Omit for all categories."),
        district: z.string().optional().describe("Filter to a single police district (e.g. 'Oslo'). Omit for all districts."),
        limit: z.number().int().min(1).max(200).optional().describe("Max number of incidents to fetch (default 50, max 200)."),
      },
      _meta: { ui: { resourceUri: DASHBOARD_URI } },
    },
    async ({ category, district, limit }) => {
      try {
        const { incidents, totalCount, source } = await fetchIncidents({
          categories: category ? [category] : undefined,
          districts: district ? [district] : undefined,
          limit,
        });
        const payload: IncidentsPayload = { incidents, totalCount, fetchedAt: new Date().toISOString(), source };
        const content: Array<{ type: "text"; text: string }> = [{ type: "text", text: JSON.stringify(payload) }];
        if (source === "mock") {
          content.unshift({
            type: "text",
            text: "NOTE: api.politiet.no is currently unreachable. The incidents below are fabricated demo data, not real police reports.",
          });
        }
        return { content };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to fetch incidents: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  registerAppResource(
    server,
    "Politiloggen Dashboard",
    DASHBOARD_URI,
    { description: "Interactive dashboard of Norwegian Police incidents with category filtering and stats." },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "index.html"), "utf-8");
      return { contents: [{ uri: DASHBOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  return server;
}

const port = process.env.PORT ? Number(process.env.PORT) : undefined;

if (port) {
  const httpServer = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, mcp-protocol-version");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    // Stateless mode: a fresh server+transport per request avoids the
    // "Server already initialized" error a shared transport hits once a
    // second client (or a reconnect) sends its own `initialize` call.
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  httpServer.listen(port, () => {
    console.log(`MCP server listening at http://localhost:${port}/mcp`);
  });
} else {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
