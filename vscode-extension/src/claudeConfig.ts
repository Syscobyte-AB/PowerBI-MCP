/**
 * claudeConfig.ts
 * Reads and writes ~/.claude/settings.json to register / deregister
 * the Power BI MCP server entry.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Credentials } from "./keychain";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const MCP_KEY = "powerbi";

interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface ClaudeSettings {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

function readSettings(): ClaudeSettings {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeSettings(settings: ClaudeSettings): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

export function upsertMcpEntry(creds: Credentials): void {
  const settings = readSettings();
  if (!settings.mcpServers) settings.mcpServers = {};

  const env: Record<string, string> = {
    PBI_TENANT_ID: creds.tenantId,
    PBI_CLIENT_ID: creds.clientId,
  };
  if (creds.clientSecret) {
    env.PBI_CLIENT_SECRET = creds.clientSecret;
  }

  settings.mcpServers[MCP_KEY] = {
    command: "npx",
    args: ["-y", "powerbi-mcp-server"],
    env,
  };

  writeSettings(settings);
}

export function removeMcpEntry(): void {
  const settings = readSettings();
  if (settings.mcpServers?.[MCP_KEY]) {
    delete settings.mcpServers[MCP_KEY];
    if (Object.keys(settings.mcpServers).length === 0) {
      delete settings.mcpServers;
    }
    writeSettings(settings);
  }
}

export function getMcpEntry(): McpServerEntry | null {
  const settings = readSettings();
  return settings.mcpServers?.[MCP_KEY] ?? null;
}

export function settingsPath(): string {
  return SETTINGS_PATH;
}
