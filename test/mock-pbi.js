/**
 * mock-pbi.js
 * A lightweight HTTP server that impersonates the Power BI REST API.
 * Used by server.test.js — no real Azure credentials required.
 */
import http from "node:http";

export const TEST_TOKEN = "test-access-token-abc123";

// ── Fake data ──────────────────────────────────────────────────────────────────
const WORKSPACES = [
  { id: "ws-001", name: "Sales Analytics", type: "Workspace", isReadOnly: false },
  { id: "ws-002", name: "Finance Reports", type: "Workspace", isReadOnly: true },
];

const DATASETS = {
  "ws-001": [
    { id: "ds-001", name: "Sales Dataset", configuredBy: "admin@company.com", isRefreshable: true, createdDate: "2024-01-01T00:00:00Z" },
    { id: "ds-002", name: "Inventory Dataset", configuredBy: "admin@company.com", isRefreshable: false, createdDate: "2024-02-01T00:00:00Z" },
  ],
};

const REPORTS = {
  "ws-001": [
    { id: "rp-001", name: "Monthly Sales", datasetId: "ds-001", webUrl: "https://app.powerbi.com/reports/rp-001" },
  ],
};

const REFRESH_HISTORY = {
  "ds-001": [
    { requestId: "r1", status: "Completed", startTime: "2024-01-10T08:00:00Z", endTime: "2024-01-10T08:05:00Z" },
    { requestId: "r2", status: "Failed",    startTime: "2024-01-09T08:00:00Z", endTime: "2024-01-09T08:01:00Z" },
  ],
};

const TABLES = {
  "ds-001": [
    { name: "Sales",    columns: [{ name: "Revenue", dataType: "Decimal" }, { name: "Date", dataType: "DateTime" }] },
    { name: "Products", columns: [{ name: "ProductID", dataType: "String" }, { name: "Name", dataType: "String" }] },
  ],
};

// ── Router ────────────────────────────────────────────────────────────────────
function handleRequest(req, res) {
  // Verify bearer token
  const auth = req.headers["authorization"] || "";
  if (auth !== `Bearer ${TEST_TOKEN}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "Unauthorized", message: "Invalid token" } }));
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname; // e.g. /groups or /groups/ws-001/datasets

  const send = (data, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  // Collect body for POST requests
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    // GET /groups — list workspaces
    if (req.method === "GET" && path === "/groups") {
      return send({ value: WORKSPACES });
    }

    // GET /groups/:wsId/datasets
    const datasetsMatch = path.match(/^\/groups\/([^/]+)\/datasets$/);
    if (req.method === "GET" && datasetsMatch) {
      const wsId = datasetsMatch[1];
      return send({ value: DATASETS[wsId] || [] });
    }

    // GET /groups/:wsId/reports
    const reportsMatch = path.match(/^\/groups\/([^/]+)\/reports$/);
    if (req.method === "GET" && reportsMatch) {
      const wsId = reportsMatch[1];
      return send({ value: REPORTS[wsId] || [] });
    }

    // POST /groups/:wsId/datasets/:dsId/executeQueries
    const daxMatch = path.match(/^\/groups\/([^/]+)\/datasets\/([^/]+)\/executeQueries$/);
    if (req.method === "POST" && daxMatch) {
      return send({
        results: [{ tables: [{ rows: [{ "[Revenue]": 1000 }, { "[Revenue]": 2000 }] }] }],
      });
    }

    // POST /groups/:wsId/datasets/:dsId/refreshes  — trigger refresh
    const refreshTriggerMatch = path.match(/^\/groups\/([^/]+)\/datasets\/([^/]+)\/refreshes$/) && req.method === "POST";
    if (req.method === "POST" && path.match(/^\/groups\/([^/]+)\/datasets\/([^/]+)\/refreshes$/)) {
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end("");
      return;
    }

    // GET /groups/:wsId/datasets/:dsId/refreshes — refresh history
    const historyMatch = path.match(/^\/groups\/([^/]+)\/datasets\/([^/]+)\/refreshes$/);
    if (req.method === "GET" && historyMatch) {
      const dsId = historyMatch[2];
      const top = parseInt(url.searchParams.get("$top") || "5", 10);
      return send({ value: (REFRESH_HISTORY[dsId] || []).slice(0, top) });
    }

    // GET /groups/:wsId/datasets/:dsId/tables
    const tablesMatch = path.match(/^\/groups\/([^/]+)\/datasets\/([^/]+)\/tables$/);
    if (req.method === "GET" && tablesMatch) {
      const dsId = tablesMatch[2];
      return send({ value: TABLES[dsId] || [] });
    }

    // 404 fallback
    send({ error: { code: "NotFound", message: `No route for ${req.method} ${path}` } }, 404);
  });
}

// ── Start / stop helpers ──────────────────────────────────────────────────────
export function startMockServer(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer(handleRequest);
    server.listen(port, "127.0.0.1", () => {
      const { port: assignedPort } = server.address();
      resolve({ server, port: assignedPort, url: `http://127.0.0.1:${assignedPort}` });
    });
  });
}

export function stopMockServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
