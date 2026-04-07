/**
 * wizard.ts
 * Step-by-step credential setup wizard using VS Code input boxes.
 * Returns a Credentials object or null if the user cancelled.
 */
import * as vscode from "vscode";
import type { Credentials } from "./keychain";

export async function runSetupWizard(existing?: Credentials | null): Promise<Credentials | null> {
  // ── Step 1: Auth mode ───────────────────────────────────────────────────────
  const authMode = await vscode.window.showQuickPick(
    [
      {
        label: "$(key) Service Principal",
        description: "Client secret — no browser, best for Azure / CI environments",
        value: "sp",
      },
      {
        label: "$(person) Interactive login (Device Code)",
        description: "Sign in with your Microsoft account — no client secret needed",
        value: "device",
      },
    ],
    {
      title: "Power BI MCP Setup (1/4)",
      placeHolder: "Which authentication mode do you want to use?",
      ignoreFocusOut: true,
    }
  );
  if (!authMode) return null;

  // ── Step 2: Tenant ID ───────────────────────────────────────────────────────
  const tenantId = await vscode.window.showInputBox({
    title: "Power BI MCP Setup (2/4) — Tenant ID",
    prompt: "Azure AD Directory (tenant) ID",
    placeHolder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    value: existing?.tenantId ?? "",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? null : "Tenant ID is required"),
  });
  if (tenantId === undefined) return null;

  // ── Step 3: Client ID ───────────────────────────────────────────────────────
  const clientId = await vscode.window.showInputBox({
    title: "Power BI MCP Setup (3/4) — Client ID",
    prompt: "Azure AD Application (client) ID",
    placeHolder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    value: existing?.clientId ?? "",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? null : "Client ID is required"),
  });
  if (clientId === undefined) return null;

  // ── Step 4: Client Secret (Service Principal only) ─────────────────────────
  let clientSecret: string | undefined;
  if (authMode.value === "sp") {
    const input = await vscode.window.showInputBox({
      title: "Power BI MCP Setup (4/4) — Client Secret",
      prompt: "Azure AD client secret value (stored securely in the OS keychain)",
      placeHolder: existing?.clientSecret ? "Leave blank to keep existing secret" : "Paste client secret here",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => {
        if (!v.trim() && !existing?.clientSecret) return "Client secret is required for Service Principal auth";
        return null;
      },
    });
    if (input === undefined) return null;
    // Keep existing secret if user left the field blank
    clientSecret = input.trim() || existing?.clientSecret;
  }

  return {
    tenantId: tenantId.trim(),
    clientId: clientId.trim(),
    clientSecret,
  };
}
