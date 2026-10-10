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
| `META_AUTH_MODE` | `per-user` (default) or explicit `shared` credentials from environment variables |
| `META_TOKEN_ENCRYPTION_KEY` | Base64 encoding of 32 random bytes; required for per-user mode |
| `META_TOKEN_DATABASE_PATH` | Persistent SQLite file for encrypted connections; defaults to `./data/meta-tools.sqlite` |
| `META_APP_ID` | Meta app ID with Facebook Login for Business configured |
| `META_APP_SECRET` | Meta app secret; required with the Graph app ID and login config |
| `META_GRAPH_LOGIN_CONFIG_ID` | Facebook Login for Business configuration ID, with the minimum Graph permissions and user access token selected |
| `THREADS_APP_ID` | Optional Threads app ID for separate Threads OAuth |
| `THREADS_APP_SECRET` | Optional Threads app secret, required with its app ID |
| `META_ACCESS_TOKEN` | Shared Graph API token; used only when `META_AUTH_MODE=shared` |
| `THREADS_ACCESS_TOKEN` | Shared Threads API token; used only when `META_AUTH_MODE=shared` |
| `META_TOOL_GROUPS` | Comma-separated tool groups, or `all`; defaults to `ads,insights,threads,utility` |
| `MCP_HOST` | Bind address; defaults to `0.0.0.0` |
| `MCP_PORT` | Bind port; defaults to `3000` |

Set app secrets and the encryption key through the deployment platform's secret manager. Generate a key with `openssl rand -base64 32`. Keep the SQLite file on persistent storage, back it up as sensitive data, and run one server replica against each SQLite file. This implementation does not support sharing the local SQLite file across replicas.

There are two separate OAuth relationships:

- **MCP access:** the server validates the user's bearer token from `MCP_AUTH_ISSUER`. The JWT `sub` is the owner key for that user's Meta connections; the OAuth `client_id` is not used as an account key. The identity provider must issue a stable, unique `sub` per user. If all callers share one service-account subject, they will intentionally share that subject's Meta connection.
- **Meta access:** call `meta_connect_account` and open the returned short-lived, single-use authorization link. Facebook Login for Business connects Graph API access for Pages, Instagram, and Ads. Threads has its own OAuth app and consent flow. After Meta's callback, copy the one-time confirmation code into `meta_complete_connection` from the MCP identity that should own the account. This pairing step prevents a forwarded OAuth link from silently attaching another user's Meta grant to the link creator. Tokens are exchanged server-side, encrypted at rest, and never returned by MCP tools.

In Meta's app dashboard, allow the exact callback URL `https://your-host/oauth/meta/callback` as a valid OAuth redirect URI. Configure Facebook Login for Business with only the permissions needed by your enabled tools and choose a user access token configuration. The Graph API client includes Meta's HMAC-SHA256 `appsecret_proof` on server API calls; this also supports enabling Meta's “Require App Secret” security setting. Configure the Graph app's deauthorization callback as `https://your-host/oauth/meta/deauthorize/graph`, data deletion callback as `https://your-host/oauth/meta/data-deletion/graph`, and data deletion instructions URL as `https://your-host/oauth/meta/data-deletion`. If you configure a separate Threads app, set its deauthorization/data-deletion callbacks to the corresponding `/threads` paths. Callbacks verify Meta's `signed_request` before deleting matching encrypted connections; data deletion status is available at the returned status URL. Request Advanced Access/App Review where Meta requires it for users outside the app's roles. The server refreshes a Threads long-lived token when it is near expiry and a Threads tool uses it; expired Facebook user tokens require the user to reconnect.

Configure the reverse proxy and access-log pipeline to redact query parameters `code` and `state` on `/oauth/meta/callback`. Meta sends the authorization code and one-time state in that callback URL; the application consumes state once and does not log callback query values, but the proxy sits in front of the app.

`META_AUTH_MODE=shared` is an opt-in compatibility mode for a single trusted operator. In that mode every caller authorized to the MCP endpoint uses the same `META_ACCESS_TOKEN` and optional `THREADS_ACCESS_TOKEN`; do not expose that deployment as a multi-tenant service. To migrate an older setup, set the explicit mode and continue setting those environment tokens, or configure per-user OAuth and remove them.

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

By default, `META_TOOL_GROUPS` enables `ads`, `insights`, `threads`, and `utility`. The utility group includes per-user account connection management, local server diagnostics, token inspection, read-only API connectivity checks, and API error explanations. Set the variable to a comma-separated list to narrow the tool surface, or use `all` for every group. Supported groups are `ad-library`, `ads`, `audiences`, `charts`, `commerce`, `conversions`, `insights`, `instagram`, `pages`, `threads`, and `utility`.

`meta_server_diagnostics` inspects the local process without making network calls. `meta_check_api_connections` (also available as `meta_health_check`) makes read-only `/me` requests to selected APIs and returns status, latency, stable error codes, and next steps. `meta_diagnose_api_error` maps a known API error code without making a request. These tools never return configured token values.

In per-user mode, `meta_list_connections` reports only the authenticated user's connected accounts. Its Graph permissions come from Meta's granted-permissions endpoint; Threads permissions reflect the scopes requested during OAuth. `meta_disconnect_account` deletes that user's encrypted token and cached Page tokens from local storage; to revoke the grant at Meta too, remove the app from Meta Business Integrations. Call `meta_connect_account` again to reconnect. `meta_complete_connection` consumes the callback's one-time pairing code and binds the grant to the caller's MCP `sub`. In shared mode, the process reads the compatibility tokens from its environment and does not load `.env` files.

The current Graph API and Threads API base versions are declared in [`src/constants.ts`](../src/constants.ts). Check current Meta developer documentation before relying on version-specific endpoint behavior.

## First calls

- Call `meta_health_check` to see whether credentials and API connectivity are available.
- Call `meta_list_connections` to inspect linked accounts and permission scopes, then `meta_debug_token` to inspect Graph token validity. Neither returns token values.
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
| A call says no Meta account is connected | Call `meta_connect_account` for Graph or Threads and open the returned link. |
| Page or Instagram call has no Page token | Call `meta_list_pages` in the current server process first. |
| Permission error | Inspect token scopes and ensure the Meta app has the permission required by that tool. |
| Threads call fails while other tools work | Connect Threads separately with `meta_connect_account`; the Threads OAuth app and scopes differ from Facebook Login for Business. |
