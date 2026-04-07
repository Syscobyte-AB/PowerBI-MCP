/**
 * keychain.ts
 * Thin wrapper around VS Code's SecretStorage API.
 * Credentials are stored in the OS keychain (Keychain on macOS,
 * Credential Manager on Windows, libsecret on Linux) — never in plaintext files.
 */
import * as vscode from "vscode";

const SERVICE = "powerbi-mcp";

export interface Credentials {
  tenantId: string;
  clientId: string;
  clientSecret?: string; // absent = device code (interactive) auth mode
}

export class Keychain {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async store(creds: Credentials): Promise<void> {
    await this.secrets.store(`${SERVICE}.tenantId`, creds.tenantId);
    await this.secrets.store(`${SERVICE}.clientId`, creds.clientId);
    if (creds.clientSecret) {
      await this.secrets.store(`${SERVICE}.clientSecret`, creds.clientSecret);
    } else {
      // Ensure any previous secret is removed when switching to device code mode
      await this.secrets.delete(`${SERVICE}.clientSecret`);
    }
  }

  async load(): Promise<Credentials | null> {
    const tenantId = await this.secrets.get(`${SERVICE}.tenantId`);
    const clientId = await this.secrets.get(`${SERVICE}.clientId`);
    if (!tenantId || !clientId) return null;

    const clientSecret = await this.secrets.get(`${SERVICE}.clientSecret`);
    return { tenantId, clientId, clientSecret: clientSecret || undefined };
  }

  async clear(): Promise<void> {
    await this.secrets.delete(`${SERVICE}.tenantId`);
    await this.secrets.delete(`${SERVICE}.clientId`);
    await this.secrets.delete(`${SERVICE}.clientSecret`);
  }

  async hasCredentials(): Promise<boolean> {
    const creds = await this.load();
    return creds !== null;
  }
}
