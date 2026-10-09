# Access tokens

## Variables used by this server

| Variable | Required | API surface |
| --- | --- | --- |
| `META_ACCESS_TOKEN` | For Graph API calls | Pages, Instagram, Marketing, Commerce, Conversions API, and related Graph API tools |
| `THREADS_ACCESS_TOKEN` | Optional | Threads API tools |

The server starts even if these variables are missing. It reads them from the MCP process environment and does not load `.env` files or retrieve secrets from 1Password or another credential service.

Configure secrets through the MCP client's environment or secret manager. Do not commit live tokens, include them in screenshots, or paste them into logs. Avoid putting app secrets in request URLs or shell history.

## Meta app setup

Create and configure a Meta app for the API surfaces you intend to use. Generate a token for the correct user, Page, or system user, and grant only the permissions needed for the requested tools. Meta controls token validity, review requirements, and available permissions; verify those details in the app dashboard and current Meta developer documentation.

Threads uses a separate token. A Graph API token does not grant Threads API access.

## Page and Instagram access

Call `meta_list_pages` at the start of a Page or Instagram session. It lists accessible Pages and caches their Page-scoped tokens in memory for subsequent operations in that server process. The cache is lost when the MCP server restarts.

Some Page reads can retry once with a refreshed Page token after a specific token error. The server does not refresh the configured user token and does not automatically replay writes.

## Diagnostics

- `meta_health_check` checks whether tokens are configured and attempts API connectivity checks.
- `meta_debug_token` reports token validity, expiry metadata, associated app/user, and granted scopes. Never include secret token values in the assistant's response.

Meta token lifetime and permission behavior depend on token type, app configuration, and current Meta policy. Use `meta_debug_token` and the Meta developer dashboard instead of relying on a fixed lifetime assumption.
