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

- Use `meta_health_check` when connection or credentials are relevant; use `meta_debug_token` for token validity and scopes.
- Never ask the user to expose a token in chat. Do not repeat token values or include them in reports.
- A listed tool does not imply that the connected token has the required Meta permission. Explain permission errors and the required scope without attempting to bypass them.
- Do not retry a failed write blindly. Read current state first unless the tool response proves the operation was rejected before execution.

## MCP guidance

When the client exposes server prompts and resources, `meta_task_workflow` and `meta://guide/agent-workflow` provide additional task guidance. They do not enforce authorization; apply the workflow above to direct tool calls as well.
