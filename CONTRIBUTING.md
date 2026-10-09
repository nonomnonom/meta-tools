# Contributing

Changes to tools, documentation, and tests are welcome. For a large feature or a change to a public tool contract, open an issue first so the scope and Meta API requirements can be discussed before implementation.

## Development setup

Use Node.js 22 or newer and npm:

```sh
npm ci
npm run build
npm test
npm audit
```

Run these checks before submitting a pull request. The test suite uses mocked API responses; do not use a live Meta account or real access token in tests.

## Code changes

- Put a tool in the domain that owns the corresponding Meta API capability.
- Keep each tool's input schema, handler, and error handling together in its feature module.
- Export feature modules from the domain's `index.ts`, then register new domains in `src/tools/index.ts`.
- Put shared Graph API or Threads transport behavior in `src/services/api.ts`.
- Add or update tests when behavior or a tool contract changes.
- Update the relevant documentation when setup, permissions, or runtime behavior changes.
- Do not commit credentials, account data, generated build output, or unrelated formatting changes.

Read [Architecture](docs/architecture.md) for module ownership and [MCP setup](docs/mcp-server.md) for runtime behavior.

## Pull requests

Use the pull request template. Describe the user-visible behavior, affected API surface and required permissions, and the checks you ran. Call out any known limitation or behavior that depends on Meta app review. CI runs the build, tests, and dependency audit on Node.js 22 and 24.
