# MCP server setup and behavior

## Runtime

`meta-tools` is an MCP server that communicates over stdio. It requires Node.js 22 or newer. Build it with `npm ci` and `npm run build`, then configure the MCP client to run `node` with the absolute path to `dist/index.js`.

```json
{
  "mcpServers": {
    "meta-tools": {
      "command": "node",
      "args": ["/absolute/path/to/meta-tools/dist/index.js"],
      "env": {
        "META_ACCESS_TOKEN": "your_meta_access_token",
        "THREADS_ACCESS_TOKEN": "your_threads_access_token"
      }
    }
  }
}
```

`META_ACCESS_TOKEN` is used for Facebook, Instagram, Marketing, Commerce, and other Graph API tools. `THREADS_ACCESS_TOKEN` is optional and is used for Threads API operations. The process reads credentials from its environment; it does not load `.env` files or fetch credentials from another service. The server can initialize with either token absent, but calls that require a missing token return an error.

The current Graph API and Threads API base versions are declared in [`src/constants.ts`](../src/constants.ts). Check current Meta developer documentation before relying on version-specific endpoint behavior.

Use the MCP client's secret or environment manager for credentials. Do not place real tokens in checked-in configuration files or command history.

## First calls

- Call `meta_health_check` to see whether credentials and API connectivity are available.
- Call `meta_debug_token` to inspect token validity and granted scopes. It reports metadata, not a replacement token.
- Call `meta_list_pages` before Page and Instagram work. This loads Page-scoped tokens into an in-memory cache for the current server process.
- Call `meta_list_ad_accounts` to discover ad account IDs before Ads Manager operations.

The Page token cache is process-local and is rebuilt after restart. API permissions are determined by the connected Meta app and token; tool availability does not grant permissions.

## Agent-facing MCP capabilities

The server registers the `meta_task_workflow` prompt with `task` and optional `platform` arguments, plus the `meta://guide/agent-workflow` resource. They guide clients to inspect state before writes, check dependencies, request confirmation for consequential actions unless already authorized, and verify results.

Prompts and resources are guidance for an MCP client. They are not an authorization boundary and do not block direct calls to write tools.

The repository includes a portable Agent Skill in [`skills/meta-tools`](../skills/meta-tools/SKILL.md). Install that folder in the skill directory supported by your agent runtime. The skill provides usage guidance; configuring the `meta-tools` MCP server is a separate step.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Server initializes, but a call says token is missing | Set the relevant token in the MCP server's `env` configuration and restart the client. |
| Page or Instagram call has no Page token | Call `meta_list_pages` in the current server session first. |
| Permission error | Inspect token scopes and ensure the Meta app has the permission required by that tool. |
| Threads call fails while other tools work | Configure `THREADS_ACCESS_TOKEN`; it is separate from the Graph API token. |
| MCP client reports invalid JSON or disconnects | Keep stdout reserved for MCP stdio messages; send diagnostic output to stderr. |
