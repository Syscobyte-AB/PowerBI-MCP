# powerbi-mcp-server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that connects Claude Code to Power BI. Query datasets with DAX, list workspaces and reports, and trigger refreshes — all via natural language.

## What you can do

| Tool | Description |
|---|---|
| `list_workspaces` | List all workspaces the account has access to |
| `list_datasets` | List datasets in a workspace |
| `list_reports` | List reports in a workspace |
| `execute_dax` | Run a DAX query and return results |
| `refresh_dataset` | Trigger a dataset refresh |
| `get_refresh_history` | Get recent refresh history |
| `get_dataset_tables` | Get table/column schema of a dataset |

## Prerequisites

- Node.js 18 or later
- A Power BI Pro or Premium workspace
- An Azure AD App Registration (details below)

---

## Authentication modes

The server automatically picks an auth mode based on which environment variables are set:

| Mode | When | Best for |
|---|---|---|
| **Service Principal** | `PBI_CLIENT_SECRET` is set | Azure-hosted environments, CI/CD, production |
| **Interactive Device Code** | `PBI_CLIENT_SECRET` is NOT set | Local development, personal use |

### Service Principal (Azure / CI)

Uses Azure AD client-credentials — no browser, no interaction. The service principal authenticates on behalf of itself (application identity).

**Required env vars:** `PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET`

### Interactive Device Code (local)

Uses the OAuth 2.0 Device Authorization Grant. On first use the server prints a URL and a short code to stderr. Open the URL in any browser, enter the code, and sign in with your Microsoft / Power BI account. The token is cached in memory and renewed silently until it expires.

**Required env vars:** `PBI_TENANT_ID`, `PBI_CLIENT_ID`  
**Not needed:** `PBI_CLIENT_SECRET`

---

## Step 1 — Create an Azure AD App Registration

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Name it (e.g. `powerbi-mcp-server`), leave defaults, click **Register**
3. Copy the **Application (client) ID** and **Directory (tenant) ID** — you will need these

### For Service Principal auth — add a client secret

4. Go to **Certificates & secrets** → **New client secret** → copy the secret value immediately

### Add API permissions

Both auth modes require these Power BI permissions:

1. Go to **API permissions** → **Add a permission** → **Power BI Service**
2. Select:
   - **Delegated permissions** (for Device Code / interactive login): `Dataset.Read.All`, `Dataset.ReadWrite.All`, `Workspace.Read.All`, `Report.Read.All`
   - **Application permissions** (for Service Principal): same four permissions
3. Click **Grant admin consent** (requires a tenant admin)

### For Service Principal — add it to your Power BI workspace

1. Open [app.powerbi.com](https://app.powerbi.com) and go to your workspace
2. Click **Access** → add the app registration by name as **Member** or **Admin**

> **Tenant setting:** An admin must enable *"Allow service principals to use Power BI APIs"* in the Power BI Admin portal under **Tenant settings**.

---

## Step 2 — Install and configure

### Option A: Run via npx (recommended)

No install needed. Add this to your Claude Code `~/.claude/settings.json`:

**Service Principal (production):**
```json
{
  "mcpServers": {
    "powerbi": {
      "command": "npx",
      "args": ["-y", "powerbi-mcp-server"],
      "env": {
        "PBI_TENANT_ID": "your-tenant-id",
        "PBI_CLIENT_ID": "your-client-id",
        "PBI_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

**Device Code / interactive login (local dev):**
```json
{
  "mcpServers": {
    "powerbi": {
      "command": "npx",
      "args": ["-y", "powerbi-mcp-server"],
      "env": {
        "PBI_TENANT_ID": "your-tenant-id",
        "PBI_CLIENT_ID": "your-client-id"
      }
    }
  }
}
```

On first use, check Claude Code's MCP server logs — the device code URL and sign-in code will be printed there.

### Option B: Run from a local clone

```bash
git clone https://github.com/Syscobyte-AB/PowerBI-MCP.git
cd powerbi-mcp-server
npm install
cp .env.example .env   # fill in your credentials
npm install dotenv     # optional — enables .env loading
```

Then in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "powerbi": {
      "command": "node",
      "args": ["/path/to/powerbi-mcp-server/index.js"]
    }
  }
}
```

Credentials are loaded from the `.env` file automatically when running locally.

---

## Step 3 — Use it in Claude Code

Restart Claude Code after editing settings. Then ask things like:

```
List my Power BI workspaces.

List the datasets in workspace abc-123.

Run this DAX against dataset xyz-456 in workspace abc-123:
EVALUATE TOPN(10, 'Sales', 'Sales'[Revenue], DESC)

Trigger a refresh of dataset xyz-456 in workspace abc-123.

Show the refresh history for that dataset.

What tables are in dataset xyz-456?
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PBI_TENANT_ID` | Yes | Azure AD tenant (directory) ID |
| `PBI_CLIENT_ID` | Yes | Azure AD application (client) ID |
| `PBI_CLIENT_SECRET` | No* | Azure AD client secret — omit to use interactive login |

*Required for Service Principal auth. Omit entirely to switch to Device Code (interactive) auth.

---

## Security notes

- **Never commit credentials.** The `.gitignore` excludes `.env` and `*.secret`.
- Credentials in the `env` block of `settings.json` are stored in plaintext. Treat that file like a password file (`chmod 600` on Linux/macOS).
- For Device Code mode, no secret is stored anywhere — authentication happens via your browser session.
- A future Phase 2 VS Code extension will store client secrets in the OS keychain via `keytar` instead.
- Rotate your client secret regularly and use the minimum required API permissions.

---

## Contributing

Issues and PRs welcome. Please open an issue before large changes.

## License

MIT — see [LICENSE](LICENSE).
