# meta-tools

`meta-tools` is a self-hosted [Model Context Protocol](https://modelcontextprotocol.io/) server for Meta business APIs, served over Streamable HTTP at `/mcp`. It gives MCP clients tools for Facebook Pages, Instagram, Threads, Ads Manager, Commerce, Conversions API, and insights.

The server can initialize before credentials are configured. A call that needs a missing token returns an actionable error. Meta permissions and app review requirements still apply to every API operation.

## What it supports

| Area | Examples |
| --- | --- |
| Facebook Pages | Posts, comments, messaging, media, settings, and insights |
| Instagram | Publishing, comments, messaging, discovery, and insights |
| Threads | Posts, replies, profiles, and insights |
| Ads Manager | Campaigns, ad sets, ads, creatives, audiences, and performance |
| Commerce and conversions | Catalogs, product sets, server-side events, and test events |
| Agent workflow | A task prompt and guide resource for discovery, authorization, and verification |

The registered tool schemas define the available operations. See [the documentation index](docs/README.md) for API notes and coverage references.

## Requirements

- Node.js 22 or newer
- A public HTTPS URL for the MCP server
- An OAuth 2.1 authorization server that issues JWT access tokens for that MCP URL and the `mcp` scope
- A 32-byte encryption key for per-user Meta credentials

The default `META_AUTH_MODE=per-user` keeps each caller's Facebook/Instagram/Ads and Threads connections separate. Users call `meta_connect_account`, approve Meta in the browser, then copy the callback's one-time code into `meta_complete_connection` from the MCP identity that should own the account. Tokens are stored encrypted in a local SQLite database. Facebook/Instagram/Ads and Threads use separate Meta OAuth apps and consent flows. The older environment-token deployment remains available with explicit `META_AUTH_MODE=shared`; every authorized MCP caller then acts through that same configured business account.

By default, the server registers the `ads`, `insights`, `threads`, and `utility` tool groups. Utility includes per-user Meta account connect/list/disconnect tools, token diagnostics, server runtime diagnostics, API connection checks, and error explanations. Set `META_TOOL_GROUPS` to a comma-separated list to expose only the groups you need, or set it to `all` to register every group. Available groups: `ad-library`, `ads`, `audiences`, `charts`, `commerce`, `conversions`, `insights`, `instagram`, `pages`, `threads`, and `utility`.

## Run the self-hosted server

The MCP endpoint requires OAuth bearer tokens. Configure an identity provider to issue signed JWT access tokens with the MCP URL as the audience and the `mcp` scope. The server validates the JWT signature using the provider's JWKS endpoint, and checks issuer, audience, expiry, and scope. The MCP URL and OAuth issuer are published through protected resource metadata.

Set these variables in your deployment secret manager:

```sh
MCP_SERVER_URL=https://mcp.example.com/mcp
MCP_AUTH_ISSUER=https://identity.example.com/
MCP_AUTH_JWKS_URL=https://identity.example.com/.well-known/jwks.json
MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://claude.ai
META_AUTH_MODE=per-user
# Generate with: openssl rand -base64 32
META_TOKEN_ENCRYPTION_KEY=base64-encoded-random-32-byte-key
META_TOKEN_DATABASE_PATH=./data/meta-tools.sqlite
META_APP_ID=your_facebook_app_id
META_APP_SECRET=your_facebook_app_secret
META_GRAPH_LOGIN_CONFIG_ID=your_facebook_login_for_business_config_id
THREADS_APP_ID=your_threads_app_id
THREADS_APP_SECRET=your_threads_app_secret
META_TOOL_GROUPS=ads,insights,threads,utility
MCP_HOST=0.0.0.0
MCP_PORT=3000
```

Build and run:

```sh
npm ci
npm run build
npm start
```

Configure your MCP client with the public URL and the OAuth provider that serves that resource:

```json
{
  "mcpServers": {
    "meta-tools": {
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

The MCP client completes OAuth with the configured identity provider. Separately, each user calls `meta_connect_account` and opens the returned one-time URL to authorize Facebook Login for Business or Threads. Keep the encryption key and app secrets in the deployment secret manager. Persist the SQLite data directory across restarts and run one server replica per database file. For configuration and the shared-account migration, see [MCP setup and runtime behavior](docs/mcp-server.md).

## Agent workflow

Clients can discover the `meta_task_workflow` prompt and `meta://guide/agent-workflow` resource. They guide an agent to inspect the target, check prerequisites, confirm consequential actions, and verify the result. They are guidance for the client, not a server-side authorization boundary. A client can call write tools directly, subject to the connected token's permissions.

The portable [Agent Skill](skills/meta-tools/SKILL.md) provides the same operating guidance for runtimes that support the `SKILL.md` format. Configure the MCP server separately.

## Development

```sh
npm ci
npm run build
npm test
npm audit
```

Tests live under `tests/` by layer. Run `npm run test:unit`, `npm run test:contracts`, or `npm run test:integration` to focus a suite; `npm test` runs all three. The HTTP integration suite uses a local test identity provider and an MCP client, so it does not require Meta credentials or contact Meta APIs.

Tool registration is organized by API domain. Each domain composes focused feature modules, and `src/tools/index.ts` registers only the groups selected by `META_TOOL_GROUPS`. See [Architecture](docs/architecture.md) before adding or moving tools. HTTP diagnostics are written by the server process and should not include credentials.

GitHub Actions runs the build, tests, and dependency audit on Node.js 22 and 24 for pushes and pull requests.

## Contributing and security

- Read [Contributing](CONTRIBUTING.md) before opening a pull request.
- Follow [Security](SECURITY.md) to report a vulnerability privately.
- Review [MCP setup and runtime behavior](docs/mcp-server.md) for client configuration and troubleshooting.

## License and attribution

This project is distributed under the MIT License. The license retains the upstream copyright notice and adds Nonomxyz's copyright for project contributions. This project is not affiliated with or endorsed by Meta Platforms, Inc.; Meta API use remains subject to Meta's terms and version lifecycle. See [LICENSE](LICENSE).
