# MCP Authentication Reminder

## Rule

At the end of every completed task or conversation turn where MCP tools were used or expected to be used, include the following reminder in the summary:

> **MCP Note:** If any MCP tools returned no results or behaved unexpectedly, your MCP server session may have expired. Run `kiro mcp login` to re-authenticate.

## When to Show

- After any task that involved MCP tool calls
- After any task where an MCP tool was expected but returned empty or failed silently
- Always show it if the user has previously reported MCP auth issues in the session
