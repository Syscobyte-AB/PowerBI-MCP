/**
 * extension.ts
 * VS Code extension entry point.
 * Registers the four Power BI MCP commands and wires them together.
 */
import * as vscode from "vscode";
import * as https from "https";
import { Keychain } from "./keychain";
import { runSetupWizard } from "./wizard";
import { upsertMcpEntry, removeMcpEntry, getMcpEntry, settingsPath } from "./claudeConfig";

let keychain: Keychain;

export function activate(context: vscode.ExtensionContext): void {
  keychain = new Keychain(context.secrets);

  context.subscriptions.push(
    vscode.commands.registerCommand("powerbi-mcp.setup", cmdSetup),
    vscode.commands.registerCommand("powerbi-mcp.testConnection", cmdTestConnection),
    vscode.commands.registerCommand("powerbi-mcp.clearCredentials", cmdClearCredentials),
    vscode.commands.registerCommand("powerbi-mcp.showStatus", cmdShowStatus)
  );

  // Notify user if the MCP entry is missing from Claude Code settings on startup
  checkConfigOnStartup();
}

export function deactivate(): void {}

// ── Setup wizard ─────────────────────────────────────────────────────────────
async function cmdSetup(): Promise<void> {
  const existing = await keychain.load();
  const creds = await runSetupWizard(existing);
  if (!creds) return; // user cancelled

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Power BI MCP: Saving configuration..." },
    async () => {
      await keychain.store(creds);
      upsertMcpEntry(creds);
    }
  );

  const authMode = creds.clientSecret ? "Service Principal" : "Device Code (interactive)";
  const action = await vscode.window.showInformationMessage(
    `Power BI MCP configured (${authMode}). Restart Claude Code to apply.`,
    "Test Connection",
    "Open Settings File"
  );

  if (action === "Test Connection") await cmdTestConnection();
  if (action === "Open Settings File") {
    vscode.window.showTextDocument(vscode.Uri.file(settingsPath()));
  }
}

// ── Test connection ───────────────────────────────────────────────────────────
async function cmdTestConnection(): Promise<void> {
  const creds = await keychain.load();
  if (!creds) {
    const action = await vscode.window.showWarningMessage(
      "Power BI MCP is not configured yet.",
      "Run Setup"
    );
    if (action === "Run Setup") await cmdSetup();
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Power BI MCP: Testing connection...",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Acquiring token..." });

      try {
        const token = await acquireToken(creds);
        progress.report({ message: "Calling Power BI API..." });
        const workspaces = await listWorkspaces(token);
        vscode.window.showInformationMessage(
          `Connection successful! Found ${workspaces.length} workspace(s).`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Connection failed: ${msg}`);
      }
    }
  );
}

// ── Clear credentials ─────────────────────────────────────────────────────────
async function cmdClearCredentials(): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    "This will remove all stored Power BI credentials and the MCP entry from Claude Code settings.",
    { modal: true },
    "Clear"
  );
  if (confirm !== "Clear") return;

  await keychain.clear();
  removeMcpEntry();
  vscode.window.showInformationMessage("Power BI MCP credentials cleared. Restart Claude Code to apply.");
}

// ── Show status ───────────────────────────────────────────────────────────────
async function cmdShowStatus(): Promise<void> {
  const creds = await keychain.load();
  const entry = getMcpEntry();

  if (!creds) {
    const action = await vscode.window.showInformationMessage(
      "Power BI MCP: Not configured.",
      "Run Setup"
    );
    if (action === "Run Setup") await cmdSetup();
    return;
  }

  const authMode = creds.clientSecret ? "Service Principal" : "Device Code (interactive)";
  const configStatus = entry ? "Present in Claude Code settings" : "MISSING from Claude Code settings";

  const action = await vscode.window.showInformationMessage(
    `Power BI MCP Status\n` +
    `• Auth mode: ${authMode}\n` +
    `• Tenant ID: ${creds.tenantId}\n` +
    `• Client ID: ${creds.clientId}\n` +
    `• Claude Code config: ${configStatus}`,
    "Test Connection",
    "Reconfigure"
  );

  if (action === "Test Connection") await cmdTestConnection();
  if (action === "Reconfigure") await cmdSetup();
}

// ── Startup check ─────────────────────────────────────────────────────────────
async function checkConfigOnStartup(): Promise<void> {
  const hasCreds = await keychain.hasCredentials();
  const hasEntry = getMcpEntry() !== null;

  if (hasCreds && !hasEntry) {
    const action = await vscode.window.showWarningMessage(
      "Power BI MCP: Credentials found but the MCP entry is missing from Claude Code settings.",
      "Restore Config"
    );
    if (action === "Restore Config") {
      const creds = await keychain.load();
      if (creds) upsertMcpEntry(creds);
      vscode.window.showInformationMessage("Power BI MCP entry restored. Restart Claude Code to apply.");
    }
  }
}

// ── Auth helpers (used by Test Connection) ────────────────────────────────────
interface TokenResponse {
  access_token: string;
  error?: string;
  error_description?: string;
}

function acquireToken(creds: { tenantId: string; clientId: string; clientSecret?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!creds.clientSecret) {
      reject(new Error("Test Connection requires Service Principal auth (client secret). Device Code auth cannot be tested from the extension."));
      return;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: "https://analysis.windows.net/powerbi/api/.default",
    }).toString();

    const options = {
      hostname: "login.microsoftonline.com",
      path: `/${creds.tenantId}/oauth2/v2.0/token`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json: TokenResponse = JSON.parse(data);
          if (json.error) reject(new Error(`${json.error}: ${json.error_description}`));
          else resolve(json.access_token);
        } catch {
          reject(new Error("Failed to parse token response"));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function listWorkspaces(token: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.powerbi.com",
      path: "/v1.0/myorg/groups?$top=100",
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data) as { value?: unknown[]; error?: { message: string } };
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.value ?? []);
        } catch {
          reject(new Error("Failed to parse Power BI API response"));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}
