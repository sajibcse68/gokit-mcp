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
import { fetchCompanyByOrgno, fetchCompanyPeople, fetchContactEmail } from "./goava.js";
import { handleAuthRoutes, authenticateRequest } from "./auth/routes.js";
import { runWithSession } from "./auth/context.js";
import { AUTH_DISABLED, FRONTEND_LOGIN_URL, JWT_SECRET, MCP_SERVER_URL, isFirebaseMode } from "./auth/config.js";
import type { IncidentsPayload, CompanyShortInfoPayload, CompanyPeoplePayload, ContactEmailPayload } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "dist");
const DASHBOARD_URI = "ui://politiloggen/dashboard.html";
const COMPANY_URI = "ui://goava/company-short-info.html";
const PEOPLE_URI = "ui://goava/company-people.html";

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
    "Police Dashboard",
    DASHBOARD_URI,
    { description: "Interactive dashboard of Norwegian Police incidents with category filtering and stats." },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "index.html"), "utf-8");
      return { contents: [{ uri: DASHBOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppTool(
    server,
    "get_company_by_orgno",
    {
      title: "Get Company Info",
      description: "Fetch short company info (name, description, registration date, website, industry) by organization number and render it in a card.",
      inputSchema: {
        orgno: z.string().min(1).describe("The company's organization number, e.g. '5560000000'."),
      },
      _meta: { ui: { resourceUri: COMPANY_URI } },
    },
    async ({ orgno }) => {
      try {
        const { company, source } = await fetchCompanyByOrgno(orgno);
        const payload: CompanyShortInfoPayload = { company, fetchedAt: new Date().toISOString(), source };
        const content: Array<{ type: "text"; text: string }> = [{ type: "text", text: JSON.stringify(payload) }];
        if (source === "mock") {
          content.unshift({
            type: "text",
            text: "NOTE: the Goava API is currently unreachable. The company info below is fabricated demo data, not a real company.",
          });
        }
        return { content };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to fetch company info: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  registerAppResource(
    server,
    "Company Short Info",
    COMPANY_URI,
    { description: "Short info card for a company looked up by organization number." },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "company.html"), "utf-8");
      return { contents: [{ uri: COMPANY_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppTool(
    server,
    "get_company_people",
    {
      title: "Get Company Contacts",
      description:
        "Fetch a company's contacts (the 'Contacts with email' group) by organization number and render them in a list. " +
        "Email addresses aren't included here — call get_contact_email to reveal one for a specific contact.",
      inputSchema: {
        orgno: z.string().min(1).describe("The company's organization number, e.g. '5560000000'."),
      },
      _meta: { ui: { resourceUri: PEOPLE_URI } },
    },
    async ({ orgno }) => {
      try {
        const payload: CompanyPeoplePayload = await fetchCompanyPeople(orgno);
        const content: Array<{ type: "text"; text: string }> = [{ type: "text", text: JSON.stringify(payload) }];
        if (payload.source === "mock") {
          content.unshift({
            type: "text",
            text: "NOTE: the Goava API is currently unreachable. The contacts below are fabricated demo data, not real people.",
          });
        }
        return { content };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to fetch company contacts: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  registerAppResource(
    server,
    "Company Contacts",
    PEOPLE_URI,
    { description: "List of a company's contacts, with per-contact email reveal, looked up by organization number." },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "people.html"), "utf-8");
      return { contents: [{ uri: PEOPLE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  // No _meta.ui here: this tool has no UI of its own — it's called from
  // inside the already-rendered Company Contacts app (registerAppTool
  // requires _meta.ui, so the plain SDK registerTool is used instead).
  server.registerTool(
    "get_contact_email",
    {
      title: "Reveal Contact Email",
      description:
        "Reveal a single contact's real email address, given the contact id and designation returned by get_company_people. " +
        "Mirrors the webapp's click-to-reveal email icon (PersonItem.jsx).",
      inputSchema: {
        id: z.number().int().describe("The contact's id, as returned by get_company_people."),
        designation: z.string().describe("The contact's designation, as returned by get_company_people."),
      },
    },
    async ({ id, designation }) => {
      try {
        const { email, source } = await fetchContactEmail(id, designation);
        const payload: ContactEmailPayload = { id, email, fetchedAt: new Date().toISOString(), source };
        const content: Array<{ type: "text"; text: string }> = [{ type: "text", text: JSON.stringify(payload) }];
        if (source === "mock") {
          content.unshift({
            type: "text",
            text: "NOTE: the Goava API is currently unreachable. This email is a fabricated demo address, not real.",
          });
        }
        return { content };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to reveal contact email: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  return server;
}

const port = process.env.PORT ? Number(process.env.PORT) : undefined;

if (port) {
  const httpServer = createServer(async (req, res) => {
    // CORS first, so an OPTIONS preflight is never rejected by the auth check.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Mcp-Session-Id, mcp-protocol-version",
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    // OAuth, discovery and the login page. Returns true once it has responded.
    if (await handleAuthRoutes(req, res)) return;

    if (new URL(req.url ?? "/", MCP_SERVER_URL).pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    // Stateless mode: a fresh server+transport per request avoids the
    // "Server already initialized" error a shared transport hits once a
    // second client (or a reconnect) sends its own `initialize` call.
    const handleMcp = async () => {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    };

    if (AUTH_DISABLED) {
      await handleMcp();
      return;
    }

    const session = await authenticateRequest(req, res);
    if (!session) return; // authenticateRequest already wrote the 401

    // Bind the session for the whole tool call so goava.ts can read the user's
    // own API token out of it. AsyncLocalStorage, not a shared variable —
    // concurrent requests would otherwise cross-contaminate.
    await runWithSession(session, handleMcp);
  });

  httpServer.listen(port, () => {
    console.log(`MCP server listening at http://localhost:${port}/mcp`);
    if (AUTH_DISABLED) {
      console.warn("WARNING: MCP_AUTH_DISABLED is set — /mcp is unauthenticated and falls back to GOAVA_API_TOKEN.");
    } else {
      console.log(`Auth: OAuth 2.0 + PKCE, ${isFirebaseMode() ? "Firebase ID token" : "direct user_id (dev)"} mode`);
      console.log(`Login page: ${FRONTEND_LOGIN_URL}`);
      if (JWT_SECRET === "change-me-in-production") {
        console.warn("WARNING: JWT_SECRET is the insecure default — set JWT_SECRET before deploying.");
      }
    }
  });
} else {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
