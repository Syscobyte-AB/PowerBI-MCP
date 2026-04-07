#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ConfidentialClientApplication,
  PublicClientApplication,
} from "@azure/msal-node";
import fetch from "node-fetch";
import { z } from "zod";

// ── Load .env if present (local dev only) ─────────────────────────────────────
try {
  const { config } = await import("dotenv");
  config();
} catch {
  // dotenv is optional — no-op if not installed
}

// ── Configuration from environment variables ──────────────────────────────────
const TENANT_ID     = process.env.PBI_TENANT_ID;
const CLIENT_ID     = process.env.PBI_CLIENT_ID;
const CLIENT_SECRET = process.env.PBI_CLIENT_SECRET; // Optional — omit to use interactive device code login
const PBI_BASE      = "https://api.powerbi.com/v1.0/myorg";
const SCOPE         = ["https://analysis.windows.net/powerbi/api/.default"];

if (!TENANT_ID || !CLIENT_ID) {
  console.error(
    "ERROR: Missing required environment variables.\n" +
    "  PBI_TENANT_ID   — Azure AD tenant (directory) ID\n" +
    "  PBI_CLIENT_ID   — Azure AD application (client) ID\n\n" +
    "Auth modes:\n" +
    "  Service Principal (Azure / CI):  also set PBI_CLIENT_SECRET\n" +
    "  Interactive Device Code (local): omit PBI_CLIENT_SECRET — you will be prompted to sign in\n\n" +
    "See README.md for full setup instructions."
  );
  process.exit(1);
}

// ── Auth setup — picks mode automatically ────────────────────────────────────
//
//   SERVICE PRINCIPAL mode  (PBI_CLIENT_SECRET is set)
//     Uses Azure AD client-credentials flow — no human interaction needed.
//     Best for production, CI, or any Azure-hosted environment.
//
//   DEVICE CODE mode  (PBI_CLIENT_SECRET is NOT set)
//     Uses the OAuth 2.0 Device Authorization Grant.
//     On first use, prints a short URL + one-time code to stderr.
//     Open the URL in a browser, enter the code, and sign in with your
//     Microsoft / Power BI account. Subsequent calls reuse the cached token
//     silently until it expires.
//
const AUTH_MODE = CLIENT_SECRET ? "service_principal" : "device_code";

let spClient        = null; // ConfidentialClientApplication (service principal)
let pubClient       = null; // PublicClientApplication       (device code)
let _cachedAccount  = null; // cached MSAL account for silent renewal

if (AUTH_MODE === "service_principal") {
  spClient = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    },
  });
  console.error("[Power BI MCP] Auth mode: Service Principal (client credentials)");
} else {
  pubClient = new PublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    },
  });
  console.error("[Power BI MCP] Auth mode: Interactive Device Code — you will be prompted to sign in on first use");
}

// ── Token acquisition ─────────────────────────────────────────────────────────
async function getAccessToken() {
  if (AUTH_MODE === "service_principal") {
    const result = await spClient.acquireTokenByClientCredential({ scopes: SCOPE });
    if (!result?.accessToken) throw new Error("Failed to acquire Power BI access token (service principal)");
    return result.accessToken;
  }

  // Device Code — try silent renewal first
  if (_cachedAccount) {
    try {
      const silent = await pubClient.acquireTokenSilent({ scopes: SCOPE, account: _cachedAccount });
      if (silent?.accessToken) return silent.accessToken;
    } catch {
      // Cached token expired — fall through to interactive device code
    }
  }

  // Interactive: print device code instructions to stderr
  const result = await pubClient.acquireTokenByDeviceCode({
    scopes: SCOPE,
    deviceCodeCallback: (response) => {
      console.error(
        "\n[Power BI MCP] Interactive login required.\n" +
        `  1. Open: ${response.verificationUri}\n` +
        `  2. Enter code: ${response.userCode}\n` +
        "  Waiting for you to complete sign-in...\n"
      );
    },
  });

  if (!result?.accessToken) throw new Error("Failed to acquire Power BI access token (device code)");
  _cachedAccount = result.account;
  return result.accessToken;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function pbiGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${PBI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Power BI API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function pbiPost(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${PBI_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Power BI API error ${res.status}: ${errBody}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : { success: true };
}

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new McpServer(
  { name: "powerbi-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool: list_workspaces ─────────────────────────────────────────────────────
server.registerTool(
  "list_workspaces",
  {
    description: "List all Power BI workspaces (groups) the signed-in account has access to",
    inputSchema: {},
  },
  async () => {
    const data = await pbiGet("/groups?$top=100");
    const workspaces = (data.value || []).map(w => ({
      id: w.id, name: w.name, type: w.type, isReadOnly: w.isReadOnly,
    }));
    return { content: [{ type: "text", text: JSON.stringify(workspaces, null, 2) }] };
  }
);

// ── Tool: list_datasets ───────────────────────────────────────────────────────
server.registerTool(
  "list_datasets",
  {
    description: "List all datasets in a Power BI workspace",
    inputSchema: z.object({
      workspace_id: z.string().describe("The workspace (group) ID"),
    }),
  },
  async ({ workspace_id }) => {
    const data = await pbiGet(`/groups/${workspace_id}/datasets`);
    const datasets = (data.value || []).map(d => ({
      id: d.id, name: d.name, configuredBy: d.configuredBy,
      isRefreshable: d.isRefreshable, createdDate: d.createdDate,
    }));
    return { content: [{ type: "text", text: JSON.stringify(datasets, null, 2) }] };
  }
);

// ── Tool: list_reports ────────────────────────────────────────────────────────
server.registerTool(
  "list_reports",
  {
    description: "List all reports in a Power BI workspace",
    inputSchema: z.object({
      workspace_id: z.string().describe("The workspace (group) ID"),
    }),
  },
  async ({ workspace_id }) => {
    const data = await pbiGet(`/groups/${workspace_id}/reports`);
    const reports = (data.value || []).map(r => ({
      id: r.id, name: r.name, datasetId: r.datasetId, webUrl: r.webUrl,
    }));
    return { content: [{ type: "text", text: JSON.stringify(reports, null, 2) }] };
  }
);

// ── Tool: execute_dax ─────────────────────────────────────────────────────────
server.registerTool(
  "execute_dax",
  {
    description: "Run a DAX query against a Power BI dataset and return results",
    inputSchema: z.object({
      workspace_id: z.string().describe("The workspace (group) ID"),
      dataset_id:   z.string().describe("The dataset ID"),
      dax_query:    z.string().describe("DAX query to execute, e.g. EVALUATE TOPN(10, Sales)"),
    }),
  },
  async ({ workspace_id, dataset_id, dax_query }) => {
    const body = { queries: [{ query: dax_query }], serializerSettings: { includeNulls: true } };
    const data = await pbiPost(`/groups/${workspace_id}/datasets/${dataset_id}/executeQueries`, body);
    const results = data.results?.[0]?.tables || [];
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// ── Tool: refresh_dataset ─────────────────────────────────────────────────────
server.registerTool(
  "refresh_dataset",
  {
    description: "Trigger a refresh of a Power BI dataset",
    inputSchema: z.object({
      workspace_id: z.string().describe("The workspace (group) ID"),
      dataset_id:   z.string().describe("The dataset ID"),
    }),
  },
  async ({ workspace_id, dataset_id }) => {
    await pbiPost(`/groups/${workspace_id}/datasets/${dataset_id}/refreshes`, {
      notifyOption: "NoNotification",
    });
    return { content: [{ type: "text", text: JSON.stringify({ status: "Refresh triggered successfully" }) }] };
  }
);

// ── Tool: get_refresh_history ─────────────────────────────────────────────────
server.registerTool(
  "get_refresh_history",
  {
    description: "Get the refresh history for a Power BI dataset",
    inputSchema: z.object({
      workspace_id: z.string().describe("The workspace (group) ID"),
      dataset_id:   z.string().describe("The dataset ID"),
      top:          z.number().optional().describe("Number of recent refreshes to return (default 5)"),
    }),
  },
  async ({ workspace_id, dataset_id, top }) => {
    const limit = (typeof top === "number" && top > 0) ? Math.min(top, 100) : 5;
    const data = await pbiGet(`/groups/${workspace_id}/datasets/${dataset_id}/refreshes?$top=${limit}`);
    return { content: [{ type: "text", text: JSON.stringify(data.value || [], null, 2) }] };
  }
);

// ── Tool: get_dataset_tables ──────────────────────────────────────────────────
server.registerTool(
  "get_dataset_tables",
  {
    description: "Get the tables and columns schema of a Power BI dataset",
    inputSchema: z.object({
      workspace_id: z.string().describe("The workspace (group) ID"),
      dataset_id:   z.string().describe("The dataset ID"),
    }),
  },
  async ({ workspace_id, dataset_id }) => {
    const data = await pbiGet(`/groups/${workspace_id}/datasets/${dataset_id}/tables`);
    return { content: [{ type: "text", text: JSON.stringify(data.value || [], null, 2) }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Power BI MCP server running (auth: ${AUTH_MODE})`);
