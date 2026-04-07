#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ConfidentialClientApplication } from "@azure/msal-node";
import fetch from "node-fetch";

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
const CLIENT_SECRET = process.env.PBI_CLIENT_SECRET;
const PBI_BASE      = "https://api.powerbi.com/v1.0/myorg";
const SCOPE         = ["https://analysis.windows.net/powerbi/api/.default"];

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "ERROR: Missing required environment variables.\n" +
    "  PBI_TENANT_ID    — Azure AD tenant ID\n" +
    "  PBI_CLIENT_ID    — Azure AD app (client) ID\n" +
    "  PBI_CLIENT_SECRET — Azure AD client secret\n\n" +
    "Set these in your Claude Code MCP settings or in a local .env file."
  );
  process.exit(1);
}

// ── MSAL auth client ──────────────────────────────────────────────────────────
const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
  },
});

async function getAccessToken() {
  const result = await msalClient.acquireTokenByClientCredential({ scopes: SCOPE });
  if (!result?.accessToken) throw new Error("Failed to acquire Power BI access token");
  return result.accessToken;
}

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

// ── Input validation helper ───────────────────────────────────────────────────
function requireArgs(args, ...fields) {
  for (const field of fields) {
    if (!args[field] || typeof args[field] !== "string" || !args[field].trim()) {
      throw new Error(`Missing required argument: ${field}`);
    }
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "list_workspaces",
    description: "List all Power BI workspaces (groups) the service principal has access to",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_datasets",
    description: "List all datasets in a Power BI workspace",
    inputSchema: {
      type: "object",
      required: ["workspace_id"],
      properties: {
        workspace_id: { type: "string", description: "The workspace (group) ID" },
      },
    },
  },
  {
    name: "list_reports",
    description: "List all reports in a Power BI workspace",
    inputSchema: {
      type: "object",
      required: ["workspace_id"],
      properties: {
        workspace_id: { type: "string", description: "The workspace (group) ID" },
      },
    },
  },
  {
    name: "execute_dax",
    description: "Run a DAX query against a Power BI dataset and return results",
    inputSchema: {
      type: "object",
      required: ["workspace_id", "dataset_id", "dax_query"],
      properties: {
        workspace_id: { type: "string", description: "The workspace (group) ID" },
        dataset_id:   { type: "string", description: "The dataset ID" },
        dax_query:    { type: "string", description: "DAX query to execute, e.g. EVALUATE TOPN(10, Sales)" },
      },
    },
  },
  {
    name: "refresh_dataset",
    description: "Trigger a refresh of a Power BI dataset",
    inputSchema: {
      type: "object",
      required: ["workspace_id", "dataset_id"],
      properties: {
        workspace_id: { type: "string", description: "The workspace (group) ID" },
        dataset_id:   { type: "string", description: "The dataset ID" },
      },
    },
  },
  {
    name: "get_refresh_history",
    description: "Get the refresh history for a Power BI dataset",
    inputSchema: {
      type: "object",
      required: ["workspace_id", "dataset_id"],
      properties: {
        workspace_id: { type: "string", description: "The workspace (group) ID" },
        dataset_id:   { type: "string", description: "The dataset ID" },
        top:          { type: "number", description: "Number of recent refreshes to return (default 5)" },
      },
    },
  },
  {
    name: "get_dataset_tables",
    description: "Get the tables and columns schema of a Power BI dataset",
    inputSchema: {
      type: "object",
      required: ["workspace_id", "dataset_id"],
      properties: {
        workspace_id: { type: "string", description: "The workspace (group) ID" },
        dataset_id:   { type: "string", description: "The dataset ID" },
      },
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {
    case "list_workspaces": {
      const data = await pbiGet("/groups?$top=100");
      const workspaces = (data.value || []).map(w => ({
        id: w.id, name: w.name, type: w.type, isReadOnly: w.isReadOnly,
      }));
      return JSON.stringify(workspaces, null, 2);
    }

    case "list_datasets": {
      requireArgs(args, "workspace_id");
      const data = await pbiGet(`/groups/${args.workspace_id}/datasets`);
      const datasets = (data.value || []).map(d => ({
        id: d.id, name: d.name, configuredBy: d.configuredBy,
        isRefreshable: d.isRefreshable, createdDate: d.createdDate,
      }));
      return JSON.stringify(datasets, null, 2);
    }

    case "list_reports": {
      requireArgs(args, "workspace_id");
      const data = await pbiGet(`/groups/${args.workspace_id}/reports`);
      const reports = (data.value || []).map(r => ({
        id: r.id, name: r.name, datasetId: r.datasetId, webUrl: r.webUrl,
      }));
      return JSON.stringify(reports, null, 2);
    }

    case "execute_dax": {
      requireArgs(args, "workspace_id", "dataset_id", "dax_query");
      const body = { queries: [{ query: args.dax_query }], serializerSettings: { includeNulls: true } };
      const data = await pbiPost(`/groups/${args.workspace_id}/datasets/${args.dataset_id}/executeQueries`, body);
      const results = data.results?.[0]?.tables || [];
      return JSON.stringify(results, null, 2);
    }

    case "refresh_dataset": {
      requireArgs(args, "workspace_id", "dataset_id");
      await pbiPost(`/groups/${args.workspace_id}/datasets/${args.dataset_id}/refreshes`, {
        notifyOption: "NoNotification",
      });
      return JSON.stringify({ status: "Refresh triggered successfully" });
    }

    case "get_refresh_history": {
      requireArgs(args, "workspace_id", "dataset_id");
      const top = (typeof args.top === "number" && args.top > 0) ? Math.min(args.top, 100) : 5;
      const data = await pbiGet(`/groups/${args.workspace_id}/datasets/${args.dataset_id}/refreshes?$top=${top}`);
      return JSON.stringify(data.value || [], null, 2);
    }

    case "get_dataset_tables": {
      requireArgs(args, "workspace_id", "dataset_id");
      const data = await pbiGet(`/groups/${args.workspace_id}/datasets/${args.dataset_id}/tables`);
      return JSON.stringify(data.value || [], null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP Server setup ──────────────────────────────────────────────────────────
const server = new Server(
  { name: "powerbi-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return { content: [{ type: "text", text: result }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Power BI MCP server running");
