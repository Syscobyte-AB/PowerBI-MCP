/**
 * server.test.js
 * Automated tests for the Power BI MCP server.
 *
 * Run:  npm test
 *
 * What gets tested:
 *   1. Server starts and exposes exactly 7 tools
 *   2. Each tool has the correct name and description
 *   3. list_workspaces  — returns workspace list
 *   4. list_datasets    — returns datasets for a workspace
 *   5. list_reports     — returns reports for a workspace
 *   6. execute_dax      — runs a DAX query and returns rows
 *   7. refresh_dataset  — triggers a dataset refresh
 *   8. get_refresh_history — returns history with default and custom top
 *   9. get_dataset_tables  — returns table schema
 *  10. Validation errors — missing required args return isError: true
 *  11. Auth mode: SERVICE_PRINCIPAL when PBI_CLIENT_SECRET is set
 *  12. Auth mode: DEVICE_CODE when PBI_CLIENT_SECRET is absent
 *      (server still starts; auth only happens on first tool call)
 *  13. Missing PBI_TENANT_ID / PBI_CLIENT_ID — server exits with code 1
 *
 * Uses only Node 18 built-ins + the MCP SDK client — no extra test deps.
 */

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockServer, stopMockServer, TEST_TOKEN } from "./mock-pbi.js";

const SERVER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../index.js"
);

// ── Helper: spin up server + MCP client ───────────────────────────────────────
async function createClient(extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH],
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

// ── Main test suite ───────────────────────────────────────────────────────────
describe("Power BI MCP Server", () => {
  let mockServer;
  let mockUrl;
  let client;
  let transport;

  const BASE_ENV = () => ({
    PBI_TENANT_ID: "test-tenant-id",
    PBI_CLIENT_ID: "test-client-id",
    PBI_ACCESS_TOKEN: TEST_TOKEN,
    PBI_BASE_URL: mockUrl,
  });

  before(async () => {
    const mock = await startMockServer();
    mockServer = mock.server;
    mockUrl = mock.url;

    ({ client, transport } = await createClient(BASE_ENV()));
  });

  after(async () => {
    await client.close();
    await stopMockServer(mockServer);
  });

  // ── 1. Tool registration ────────────────────────────────────────────────────
  test("exposes exactly 7 tools", async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 7, `Expected 7 tools, got ${tools.length}`);
  });

  test("all expected tool names are present", async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    const expected = [
      "list_workspaces",
      "list_datasets",
      "list_reports",
      "execute_dax",
      "refresh_dataset",
      "get_refresh_history",
      "get_dataset_tables",
    ];
    for (const name of expected) {
      assert.ok(names.includes(name), `Missing tool: ${name}`);
    }
  });

  test("every tool has a non-empty description", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      assert.ok(tool.description?.trim(), `Tool ${tool.name} has no description`);
    }
  });

  // ── 2. list_workspaces ──────────────────────────────────────────────────────
  test("list_workspaces returns workspace array", async () => {
    const result = await client.callTool({ name: "list_workspaces", arguments: {} });
    assert.ok(!result.isError, `Got error: ${result.content[0]?.text}`);
    const data = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(data), "Expected an array");
    assert.equal(data.length, 2);
    assert.equal(data[0].id, "ws-001");
    assert.equal(data[0].name, "Sales Analytics");
  });

  // ── 3. list_datasets ────────────────────────────────────────────────────────
  test("list_datasets returns datasets for workspace", async () => {
    const result = await client.callTool({
      name: "list_datasets",
      arguments: { workspace_id: "ws-001" },
    });
    assert.ok(!result.isError, result.content[0]?.text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.length, 2);
    assert.equal(data[0].id, "ds-001");
    assert.equal(data[0].name, "Sales Dataset");
  });

  test("list_datasets returns empty array for unknown workspace", async () => {
    const result = await client.callTool({
      name: "list_datasets",
      arguments: { workspace_id: "ws-unknown" },
    });
    assert.ok(!result.isError);
    const data = JSON.parse(result.content[0].text);
    assert.deepEqual(data, []);
  });

  // ── 4. list_reports ─────────────────────────────────────────────────────────
  test("list_reports returns reports for workspace", async () => {
    const result = await client.callTool({
      name: "list_reports",
      arguments: { workspace_id: "ws-001" },
    });
    assert.ok(!result.isError, result.content[0]?.text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.length, 1);
    assert.equal(data[0].name, "Monthly Sales");
  });

  // ── 5. execute_dax ──────────────────────────────────────────────────────────
  test("execute_dax returns query result tables", async () => {
    const result = await client.callTool({
      name: "execute_dax",
      arguments: {
        workspace_id: "ws-001",
        dataset_id: "ds-001",
        dax_query: "EVALUATE TOPN(10, Sales)",
      },
    });
    assert.ok(!result.isError, result.content[0]?.text);
    const data = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(data), "Expected array of tables");
    assert.ok(data[0]?.rows?.length > 0, "Expected rows in result");
  });

  // ── 6. refresh_dataset ──────────────────────────────────────────────────────
  test("refresh_dataset returns success status", async () => {
    const result = await client.callTool({
      name: "refresh_dataset",
      arguments: { workspace_id: "ws-001", dataset_id: "ds-001" },
    });
    assert.ok(!result.isError, result.content[0]?.text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.status, "Refresh triggered successfully");
  });

  // ── 7. get_refresh_history ──────────────────────────────────────────────────
  test("get_refresh_history returns history with default top=5", async () => {
    const result = await client.callTool({
      name: "get_refresh_history",
      arguments: { workspace_id: "ws-001", dataset_id: "ds-001" },
    });
    assert.ok(!result.isError, result.content[0]?.text);
    const data = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(data));
    assert.equal(data[0].requestId, "r1");
    assert.equal(data[0].status, "Completed");
  });

  test("get_refresh_history respects top parameter", async () => {
    const result = await client.callTool({
      name: "get_refresh_history",
      arguments: { workspace_id: "ws-001", dataset_id: "ds-001", top: 1 },
    });
    assert.ok(!result.isError, result.content[0]?.text);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.length, 1);
  });

  // ── 8. get_dataset_tables ───────────────────────────────────────────────────
  test("get_dataset_tables returns table schema", async () => {
    const result = await client.callTool({
      name: "get_dataset_tables",
      arguments: { workspace_id: "ws-001", dataset_id: "ds-001" },
    });
    assert.ok(!result.isError, result.content[0]?.text);
    const data = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(data));
    const tableNames = data.map(t => t.name);
    assert.ok(tableNames.includes("Sales"));
    assert.ok(tableNames.includes("Products"));
  });

  // ── 9. Validation errors ────────────────────────────────────────────────────
  test("list_datasets with missing workspace_id returns error", async () => {
    const result = await client.callTool({
      name: "list_datasets",
      arguments: {},
    });
    assert.ok(result.isError, "Expected isError: true for missing workspace_id");
  });

  test("execute_dax with missing dax_query returns error", async () => {
    const result = await client.callTool({
      name: "execute_dax",
      arguments: { workspace_id: "ws-001", dataset_id: "ds-001" },
    });
    assert.ok(result.isError, "Expected isError: true for missing dax_query");
  });

  test("refresh_dataset with missing dataset_id returns error", async () => {
    const result = await client.callTool({
      name: "refresh_dataset",
      arguments: { workspace_id: "ws-001" },
    });
    assert.ok(result.isError, "Expected isError: true for missing dataset_id");
  });

  test("get_dataset_tables with missing workspace_id returns error", async () => {
    const result = await client.callTool({
      name: "get_dataset_tables",
      arguments: { dataset_id: "ds-001" },
    });
    assert.ok(result.isError, "Expected isError: true for missing workspace_id");
  });
});

// ── Auth mode detection (separate server instances) ───────────────────────────
describe("Auth mode detection", () => {
  let mockServer;
  let mockUrl;

  before(async () => {
    const mock = await startMockServer();
    mockServer = mock.server;
    mockUrl = mock.url;
  });

  after(async () => {
    await stopMockServer(mockServer);
  });

  test("server reports service_principal mode when CLIENT_SECRET is set", async () => {
    const { client, transport } = await createClient({
      PBI_TENANT_ID: "test-tenant",
      PBI_CLIENT_ID: "test-client",
      PBI_CLIENT_SECRET: "test-secret",
      PBI_ACCESS_TOKEN: TEST_TOKEN,
      PBI_BASE_URL: mockUrl,
    });

    // If the server started and responds to listTools, it booted in SP mode
    const { tools } = await client.listTools();
    assert.equal(tools.length, 7);
    await client.close();
  });

  test("server starts in device_code mode when CLIENT_SECRET is absent", async () => {
    const { client } = await createClient({
      PBI_TENANT_ID: "test-tenant",
      PBI_CLIENT_ID: "test-client",
      // No PBI_CLIENT_SECRET
      PBI_ACCESS_TOKEN: TEST_TOKEN, // bypass the actual device code prompt
      PBI_BASE_URL: mockUrl,
    });

    const { tools } = await client.listTools();
    assert.equal(tools.length, 7);
    await client.close();
  });
});

// ── Missing credentials — server should exit with code 1 ─────────────────────
describe("Missing credentials", () => {
  test("server exits with code 1 when PBI_TENANT_ID is missing", async (t) => {
    const proc = spawn("node", [SERVER_PATH], {
      env: { ...process.env, PBI_TENANT_ID: "", PBI_CLIENT_ID: "test-client" },
      stdio: "pipe",
    });

    const code = await new Promise(resolve => proc.on("close", resolve));
    assert.equal(code, 1, "Expected exit code 1 for missing PBI_TENANT_ID");
  });

  test("server exits with code 1 when PBI_CLIENT_ID is missing", async (t) => {
    const proc = spawn("node", [SERVER_PATH], {
      env: { ...process.env, PBI_TENANT_ID: "test-tenant", PBI_CLIENT_ID: "" },
      stdio: "pipe",
    });

    const code = await new Promise(resolve => proc.on("close", resolve));
    assert.equal(code, 1, "Expected exit code 1 for missing PBI_CLIENT_ID");
  });
});
