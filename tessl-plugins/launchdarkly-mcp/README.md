# launchdarkly-mcp

A local Tessl plugin that connects agents to the LaunchDarkly hosted MCP server (`https://mcp.launchdarkly.com/mcp`) with an API access token instead of OAuth.

It exists because Tessl's MCP gateway can't register with LaunchDarkly's OAuth server: the gateway registers as a confidential client, and LaunchDarkly only accepts public clients that use PKCE (`token_endpoint_auth_method: none`). Token auth skips that registration entirely.

## How it works

- `.mcp.json` declares one HTTP server, `launchdarkly-token`, that sends `Authorization: Bearer ${LD_ACCESS_TOKEN}`.
- `tessl install` copies it into each agent's own MCP config (for Claude Code, the repo's `.mcp.json`). Only the variable name is committed, never the token.
- The agent fills in `${LD_ACCESS_TOKEN}` from its environment when it connects.

## Setup

1. Create a LaunchDarkly **service token** (Organization settings > Authorization > Create token) with only the access agents need, such as Writer on the ToggleWear project.
2. Store it as `LD_ACCESS_TOKEN` in the Tessl environment the runs use. Never commit it or paste it into a chat.
3. For local Claude Code sessions, the server stays off until you approve it. If you already use the `launchdarkly` Claude Code plugin, which signs in with OAuth, you can leave this one unapproved.

## Changing it

Edit the files here, then reinstall:

```bash
tessl install file:./tessl-plugins/launchdarkly-mcp
```
