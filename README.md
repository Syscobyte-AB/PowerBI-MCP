# powerbi-mcp-server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that connects Claude Code to Power BI. Query datasets with DAX, list workspaces and reports, and trigger refreshes — all via natural language.

## What you can do

| Tool | Description |
|---|---|
| `list_workspaces` | List all workspaces the service principal can access |
| `list_datasets` | List datasets in a workspace |
| `list_reports` | List reports in a workspace |
| `execute_dax` | Run a DAX query and return results |
| `refresh_dataset` | Trigger a dataset refresh |
| `get_refresh_history` | Get recent refresh history |
| `get_dataset_tables` | Get table/column schema of a dataset |

## Prerequisites

- Node.js 18 or later
- A Power BI Pro or Premium workspace
- An Azure AD App Registration (service principal) with Power BI API permissions

---

## Step 1 — Create an Azure AD App Registration

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Name it (e.g. `powerbi-mcp-server`), leave defaults, click **Register**
3. Copy the **Application (client) ID** and **Directory (tenant) ID** — you'll need these
4. Go to **Certificates & secrets** → **New client secret** → copy the secret value immediately

### Add API permissions

1. Go to **API permissions** → **Add a permission** → **Power BI Service**
2. Select **Application permissions** (not Delegated)
3. Add all of these:
   - `Dataset.Read.All`
   - `Dataset.ReadWrite.All`
   - `Workspace.Read.All`
   - `Report.Read.All`
4. Click **Grant admin consent** (requires an admin)

### Add the service principal to your Power BI workspace

1. Open [app.powerbi.com](https://app.powerbi.com) and go to your workspace
2. Click **Access** → add the app registration by name as a **Member** or **Admin**

> **Tenant setting:** An admin must also enable *"Allow service principals to use Power BI APIs"* in the Power BI Admin portal under **Tenant settings**.

---

## Step 2 — Install and configure

### Option A: Run via npx (recommended)

No install needed. Add this to your Claude Code `~/.claude/settings.json`:

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

### Option B: Run from a local clone

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/powerbi-mcp-server.git
cd powerbi-mcp-server
npm install
cp .env.example .env   # fill in your credentials for local dev
```

Then in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "powerbi": {
      "command": "node",
      "args": ["/path/to/powerbi-mcp-server/index.js"],
      "env": {
        "PBI_TENANT_ID": "your-tenant-id",
        "PBI_CLIENT_ID": "your-client-id",
        "PBI_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

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
| `PBI_CLIENT_SECRET` | Yes | Azure AD client secret value |

For local development you can put these in a `.env` file (install `dotenv` via `npm install dotenv`). The `.env` file is gitignored and never required in production.

---

## Security notes

- **Never commit credentials.** The `.gitignore` excludes `.env` and `*.secret`.
- Credentials passed via the `env` block in `settings.json` are stored in plaintext on disk. Treat that file like a password file (chmod 600 on Linux/macOS).
- A future Phase 2 VS Code extension will store credentials in the OS keychain via `keytar` instead.
- Rotate your client secret regularly and use the minimum required API permissions.

---

## Contributing

Issues and PRs welcome. Please open an issue before large changes.

## License

MIT — see [LICENSE](LICENSE).
