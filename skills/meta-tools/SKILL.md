---
name: meta-tools
description: Use the meta-tools MCP server for Facebook Pages, Instagram, Threads, Ads Manager, Commerce, and Meta insights tasks. Applies when its MCP tools are available in the current session.
---

# meta-tools MCP

Use this skill when a task should be completed through the `meta-tools` MCP server. The server must already be configured in the current MCP client. If its tools are unavailable, explain that the agent needs a `meta-tools` MCP connection before it can act; do not pretend a Meta action was performed.

## Workflow

1. Discover the tools available from `meta-tools` and choose the narrowest tool for the requested outcome. Treat the active tool schema and response as authoritative; do not guess parameters or IDs.
2. Inspect the current account and target asset before acting. Call `meta_list_pages` before Page or Instagram operations because it populates the current process's Page-token cache. Use `meta_list_ad_accounts` to discover ad account IDs before Ads Manager work. Threads uses a separate token.
3. For a multi-step task, identify prerequisites and use reads before writes. If a target, scope, content, or effect is ambiguous, ask a focused question before proceeding.
4. Before a consequential write, deletion, publication, budget change, or action affecting other people, summarize the exact target and effect and obtain the user's explicit confirmation unless the user already authorized that exact action. Authorization for one action does not authorize a different target or broader action.
5. Execute only the authorized operation. If a write times out or returns an ambiguous error, inspect current state before retrying to avoid duplicate posts, events, or changes.
6. Verify the result with a read when possible. Report what succeeded, what failed, and what remains, using tool output as evidence.

## Authentication and errors

- Start with `meta_list_connections`. If the required Graph or Threads account is missing, call `meta_connect_account` (`provider=graph` for Facebook Pages, Instagram, and Ads; `provider=threads` for Threads), then give the user the returned authorization link to open. OAuth is handled by Meta; never request a token copied from a dashboard or chat.
- After Meta redirects to the callback, ask the user to provide the displayed one-time confirmation code, then call `meta_complete_connection` using the same MCP identity that should own the connected account. Verify with `meta_list_connections` before continuing. Graph and Threads require separate connections.
- If a connection is expired or revoked, explain that the user must reconnect with the same flow. Only call `meta_disconnect_account` when the user asks to disconnect that provider.
- Use `meta_health_check` when connection or credentials are relevant; use `meta_debug_token` for token validity and scopes.
- Never ask the user to expose a token in chat. Do not repeat token values or include them in reports.
- A listed tool does not imply that the connected token has the required Meta permission. Explain permission errors and the required scope without attempting to bypass them.
- Do not retry a failed write blindly. Read current state first unless the tool response proves the operation was rejected before execution.

## MCP guidance

When the client exposes server prompts and resources, `meta_task_workflow` and `meta://guide/agent-workflow` provide additional task guidance. They do not enforce authorization; apply the workflow above to direct tool calls as well.
