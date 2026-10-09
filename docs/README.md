# Documentation index

This directory contains implementation guidance and API research notes. The MCP server's source code and registered tool schemas define the behavior of the shipped server.

## Project documentation

- [MCP server setup](mcp-server.md): runtime configuration, startup behavior, and agent-facing MCP capabilities.
- [Architecture](architecture.md): server lifecycle, registration boundaries, and source layout.
- [Access tokens](authentication/access-tokens.md): credentials required by this implementation and token diagnostics.

The [project README](../README.md) describes installation, supported operations, and development. See [Contributing](../CONTRIBUTING.md) for code and pull request guidance.

## API references and research

- [Graph API overview](graph-api/overview.md)
- [Facebook Pages API](pages-api/overview.md), [Page insights](pages-api/insights-metrics.md), and [Page node reference](pages-api/page-node-reference.md)
- [Instagram API](instagram-api/overview.md), [publishing](instagram-api/content-publishing.md), and [insights metrics](instagram-api/insights-metrics.md)
- [Marketing API](marketing-api/overview.md), [audiences](marketing-api/audiences.md), [insights](marketing-api/insights-api.md), and [metrics](marketing-api/insights-metrics.md)
- [Threads API](threads-api/overview.md), [publishing](threads-api/create-posts.md), and [insights](threads-api/insights.md)
- [API coverage audit](api-coverage-audit.md), [gap analysis](api-gap-analysis.md), and [undocumented API research](undocumented-apis-research.md)

Some API reference documents are dated snapshots and may describe older versions or availability. Check their source and date before relying on endpoint support, permissions, fields, or version lifecycle. Runtime versions are declared in [`src/constants.ts`](../src/constants.ts); tool behavior and parameter schemas are defined under [`src/tools`](../src/tools/).
