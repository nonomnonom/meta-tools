# MCP server setup and behavior

## Remote endpoint

`meta-tools` serves MCP over Streamable HTTP at `https://your-host/mcp`. It does not start a stdio transport. The process binds to `MCP_HOST` and `MCP_PORT` (defaults: `0.0.0.0:3000`); put it behind a TLS reverse proxy or load balancer for a public deployment. The server validates the incoming Host header against the hostname in `MCP_SERVER_URL` to prevent DNS rebinding.

The endpoint is an OAuth resource server. Configure an OAuth 2.1 identity provider to issue signed JWT access tokens with:

- `iss` equal to `MCP_AUTH_ISSUER`
- `aud` equal to the complete `MCP_SERVER_URL`, including `/mcp`
- an unexpired `exp` claim and a `sub` claim
- `mcp` in the space-delimited `scope` claim (or the `scopes` array)

The server checks the JWT signature against the configured JWKS URL and validates issuer, audience, expiry, and scope. It validates browser Origin headers against `MCP_ALLOWED_ORIGINS`; native clients without an Origin header are allowed. It does not issue or refresh access tokens; the client obtains tokens from the configured identity provider. The OAuth protected resource metadata endpoint is `/.well-known/oauth-protected-resource/mcp`.

Required configuration:

| Variable | Purpose |
| --- | --- |
| `MCP_SERVER_URL` | Public endpoint URL, such as `https://mcp.example.com/mcp` |
| `MCP_AUTH_ISSUER` | Exact JWT issuer value from the identity provider |
| `MCP_AUTH_JWKS_URL` | HTTPS URL for the identity provider's signing keys |
| `MCP_ALLOWED_ORIGINS` | Comma-separated browser Origin allowlist; leave empty for native clients that send no Origin header |
| `META_ACCESS_TOKEN` | Meta Graph API access token used by enabled tools |
| `THREADS_ACCESS_TOKEN` | Optional separate Threads API token |
| `META_TOOL_GROUPS` | Comma-separated tool groups, or `all`; defaults to `ads,insights,threads,utility` |
| `MCP_HOST` | Bind address; defaults to `0.0.0.0` |
| `MCP_PORT` | Bind port; defaults to `3000` |

Set secrets through the deployment platform's secret manager. The MCP caller's OAuth identity controls access to the service, while the configured Meta token determines which Meta account and permissions the tools can use. This server is intended for a trusted deployment owner; it does not map each MCP caller to a separate Meta account.

Build and launch:

```sh
npm ci
npm run build
npm start
```

MCP client configuration uses the hosted endpoint URL and its OAuth provider, not a local command:

```json
{
  "mcpServers": {
    "meta-tools": {
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

The client and authorization provider must support OAuth-protected remote MCP servers. For local development only, `MCP_SERVER_URL` may use `http://localhost`, `127.0.0.1`, or `[::1]`; public deployments require HTTPS.

## Tool groups and credentials

By default, `META_TOOL_GROUPS` enables `ads`, `insights`, `threads`, and `utility`. The utility group includes local server diagnostics, token inspection, read-only API connectivity checks, and API error explanations. Set the variable to a comma-separated list to narrow the tool surface, or use `all` for every group. Supported groups are `ad-library`, `ads`, `audiences`, `charts`, `commerce`, `conversions`, `insights`, `instagram`, `pages`, `threads`, and `utility`.

`meta_server_diagnostics` inspects the local process without making network calls. `meta_check_api_connections` (also available as `meta_health_check`) makes read-only `/me` requests to selected APIs and returns status, latency, stable error codes, and next steps. `meta_diagnose_api_error` maps a known API error code without making a request. These tools never return configured token values.

`META_ACCESS_TOKEN` is used for Facebook, Instagram, Marketing, Commerce, and other Graph API tools. `THREADS_ACCESS_TOKEN` is optional and is used for Threads API operations. The process reads credentials from its environment; it does not load `.env` files or fetch Meta credentials from another service. Calls that require an unset token return an error.

The current Graph API and Threads API base versions are declared in [`src/constants.ts`](../src/constants.ts). Check current Meta developer documentation before relying on version-specific endpoint behavior.

## First calls

- Call `meta_health_check` to see whether credentials and API connectivity are available.
- Call `meta_debug_token` to inspect token validity and granted scopes. It reports metadata, not a replacement token.
- Call `meta_list_pages` before Page and Instagram work. This loads Page-scoped tokens into an in-memory cache for the current process.
- Call `meta_list_ad_accounts` to discover ad account IDs before Ads Manager operations.

## MCP protocol debugging

Use the official [MCP Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector) to inspect transport behavior, list schemas, and invoke tools interactively. Its web client is the best first pass for OAuth and request/response inspection; the CLI is useful for repeatable probes, and the TUI provides a terminal workflow.

```sh
npm run inspect:web
npm run inspect:tui
npm run inspect:cli -- --server-url "$MCP_SERVER_URL" --transport http --method tools/list --strict --format json
```

For an OAuth-protected remote server, sign in with the web Inspector first, then use the CLI's stored OAuth state (`--use-stored-auth`) for repeatable local probes. Keep that state private. The CLI supports `initialize`, `tools/list`, and `tools/call`; `--strict` checks tool-schema portability and returns a nonzero exit for schema errors. See the [Inspector CLI reference](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/cli) for auth, output, and exit-code details.

After connecting in Inspector, call `meta_server_diagnostics` for process state, `meta_check_api_connections` for read-only Graph/Threads access checks, `meta_debug_token` for token scopes/expiry, or `meta_diagnose_api_error` for an error-code explanation. These tools complement Inspector's protocol trace; they do not run shell commands or modify account state.

The Page token cache is process-local and is rebuilt after restart. API permissions are determined by the configured Meta app and token; tool availability does not grant permissions.

## Agent-facing MCP capabilities

The server registers the `meta_task_workflow` prompt with `task` and optional `platform` arguments, plus the `meta://guide/agent-workflow` resource. They guide clients to inspect state before writes, check dependencies, request confirmation for consequential actions unless already authorized, and verify results. Prompts and resources are guidance, not an authorization boundary; callers can directly invoke write tools allowed by the configured Meta token.

The repository includes a portable Agent Skill in [`skills/meta-tools`](../skills/meta-tools/SKILL.md). Install it in the skill directory supported by your agent runtime. The skill provides usage guidance; connecting the hosted MCP server is a separate step.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Client gets `401 invalid_token` | Check token signature, issuer, audience, expiry, and `mcp` scope; confirm the IdP issues tokens for the full MCP URL. |
| Client gets `403 insufficient_scope` | Add `mcp` to the access token's scope. |
| Client cannot reach the server | Check the public HTTPS URL, reverse proxy routing, and the process bind host and port. |
| Request is rejected for an invalid host | Make sure the request Host matches the hostname in `MCP_SERVER_URL` and the proxy forwards the original host. |
| A call says the Meta token is missing | Set the relevant Meta token in the deployment secret manager and restart. |
| Page or Instagram call has no Page token | Call `meta_list_pages` in the current server process first. |
| Permission error | Inspect token scopes and ensure the Meta app has the permission required by that tool. |
| Threads call fails while other tools work | Configure `THREADS_ACCESS_TOKEN`; it is separate from the Graph API token. |
