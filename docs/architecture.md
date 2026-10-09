# Architecture

## Request path

```text
src/index.ts
  ├── src/config.ts             Read optional credentials from process environment
  └── src/server.ts             Create the MCP server and Meta API client
        └── src/tools/index.ts   Register all MCP capabilities
              ├── domain/index.ts
              └── domain/feature.ts
                    ├── services/api.ts
                    └── services/utils.ts
```

`src/index.ts` is the executable entry point. `src/server.ts` composes the MCP server and shared API client. `src/tools/index.ts` is the single registry used by server startup. Each domain `index.ts` composes its domain's feature modules; each feature module owns its tool schemas and handlers.

The build removes `dist/` before compiling so deleted or renamed source modules cannot remain in release artifacts. `npm pack` runs the build before creating a package.

## Source layout

```text
src/
├── config.ts
├── index.ts
├── server.ts
├── constants.ts
├── types.ts
├── services/
│   ├── api.ts
│   └── utils.ts
└── tools/
    ├── index.ts
    ├── pages/
    ├── instagram/
    ├── ads/
    ├── threads/
    ├── ad-library/
    ├── agent-workflow/
    ├── audiences/
    ├── charts/
    ├── commerce/
    ├── conversions/
    ├── insights/
    └── utility/
```

## Ownership rules

- Add or change a tool in the module for the API capability it owns. Keep its input schema, annotations, handler, and error conversion together.
- Add a new feature module to its domain `index.ts`; add a new domain to `src/tools/index.ts`.
- Put shared Graph API and Threads transport behavior in `services/api.ts`, and response formatting or shared schemas in `services/utils.ts`.
- Keep API roots and version constants in `constants.ts`; avoid duplicating them in tool handlers.
- Keep stdio stdout protocol-only. Diagnostics belong on stderr.

## Agent workflow prompt and resource

`tools/agent-workflow/index.ts` registers an MCP prompt and resource. They provide reusable guidance to clients, while each tool remains independently callable. The prompt is not an authorization mechanism; server-side access is still governed by the user's Meta token and API permissions.
