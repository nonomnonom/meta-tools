# meta-tools

`meta-tools` is a stdio [Model Context Protocol](https://modelcontextprotocol.io/) server for Meta business APIs. It gives MCP clients tools for Facebook Pages, Instagram, Threads, Ads Manager, Commerce, Conversions API, and insights.

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
- `META_ACCESS_TOKEN` for Graph API operations
- `THREADS_ACCESS_TOKEN` for Threads operations

`THREADS_ACCESS_TOKEN` is optional when Threads tools are not needed. Tokens are read from the MCP server process environment. The server does not load `.env` files.

## Run from a checkout

Install dependencies and build the server:

```sh
npm ci
npm run build
```

Configure your MCP client to launch the compiled entry point. Replace the path with the absolute path to this checkout:

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

Keep credentials in your MCP client's secret or environment manager. Do not commit real tokens or paste them into issues, pull requests, or logs. For token setup and diagnostics, see [Access tokens](docs/authentication/access-tokens.md).

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

Tool registration is organized by API domain. Each domain composes focused feature modules, and `src/tools/index.ts` registers the server's capabilities. See [Architecture](docs/architecture.md) before adding or moving tools. Keep stdout reserved for MCP protocol messages; diagnostics belong on stderr.

GitHub Actions runs the build, tests, and dependency audit on Node.js 22 and 24 for pushes and pull requests.

## Contributing and security

- Read [Contributing](CONTRIBUTING.md) before opening a pull request.
- Follow [Security](SECURITY.md) to report a vulnerability privately.
- Review [MCP setup and runtime behavior](docs/mcp-server.md) for client configuration and troubleshooting.

## License and attribution

This project is distributed under the MIT License. The license retains the upstream copyright notice and adds Nonomxyz's copyright for project contributions. This project is not affiliated with or endorsed by Meta Platforms, Inc.; Meta API use remains subject to Meta's terms and version lifecycle. See [LICENSE](LICENSE).
