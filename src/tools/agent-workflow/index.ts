import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Registers MCP-native guidance that helps clients plan multi-step Meta work. */
export function registerAgenticCapabilities(server: McpServer): void {
  server.registerPrompt(
    "meta_task_workflow",
    {
      title: "Plan and execute a Meta task",
      description: "Guides an assistant through discovery, verification, execution, and reporting for Meta platform tasks.",
      argsSchema: {
        task: z.string().min(1).describe("What the user wants to accomplish"),
        platform: z.string().optional().describe("Facebook, Instagram, Threads, Ads, or Commerce"),
      },
    },
    ({ task, platform }) => ({
      description: "A safe, tool-guided workflow for the requested Meta task.",
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Task: ${task}`,
            platform ? `Platform: ${platform}` : "Platform: determine from the task, and ask if ambiguous.",
            "Use the available meta-tools tools as the source of truth. First inspect relevant assets and current state; check authentication and required permissions when needed.",
            "For multi-step work, explain the proposed steps and dependencies. Use read operations to verify IDs and current state before mutations.",
            "Before any consequential write, deletion, publishing, budget change, or action affecting other people, summarize the exact action and obtain the user's explicit confirmation unless they already explicitly authorized that exact action.",
            "Execute only authorized steps. Verify the result with a read when possible, report what succeeded or failed, and never claim an action succeeded without tool evidence.",
          ].join("\n\n"),
        },
      }],
    })
  );

  server.registerResource(
    "agent-workflow-guide",
    "meta://guide/agent-workflow",
    {
      title: "Meta tools agent workflow guide",
      description: "Discovery, safe execution, and verification guidance for AI agents using this MCP server.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown",
        text: [
          "# Agent workflow guide",
          "",
          "1. Discover available tools and select the narrowest tool for the user's goal.",
          "2. Inspect account, Page, Instagram, campaign, or other asset IDs before using them.",
          "3. Check token health and permissions if a call fails; do not expose tokens in responses.",
          "4. For tasks with dependencies, perform reads first and explain the proposed sequence.",
          "5. Obtain explicit user confirmation before consequential writes unless that exact action was already authorized.",
          "6. Verify completed changes with a read and report evidence, failures, and remaining steps.",
          "",
          "Tool availability does not imply that a connected Meta account has the required permissions.",
        ].join("\n"),
      }],
    })
  );
}
