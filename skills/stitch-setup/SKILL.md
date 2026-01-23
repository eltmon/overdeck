---
name: stitch-setup
description: Set up Google Stitch MCP server for AI-powered UI design generation
---

# Stitch MCP Server Setup

This skill helps you set up the Google Stitch MCP server, which enables AI agents to generate UI designs.

## What is Stitch?

Google Stitch is a free AI-powered UI design tool that generates production-ready HTML/CSS from natural language descriptions. The Stitch MCP server connects Claude Code and other AI agents to the Stitch API.

## Prerequisites

- Google Cloud account
- Node.js 18+

## Quick Setup

Run the initialization command:

```bash
npx @_davideast/stitch-mcp init
```

This automates the entire setup process:
1. Installs Google Cloud CLI if needed
2. Guides you through Google authentication
3. Sets up application credentials
4. Lets you select a GCP project
5. Configures required IAM permissions
6. Enables the Stitch API
7. Generates MCP configuration

## Manual Configuration

After running init, add the Stitch MCP server to your Claude Code settings:

**For Claude Code (`~/.claude/settings.json`):**

```json
{
  "mcpServers": {
    "stitch": {
      "command": "npx",
      "args": ["@_davideast/stitch-mcp", "proxy"],
      "env": {
        "STITCH_PROJECT_ID": "your-project-id"
      }
    }
  }
}
```

## Verify Setup

Run the doctor command to verify your setup:

```bash
npx @_davideast/stitch-mcp doctor
```

## Using Stitch

Once configured, you can use Stitch in Claude Code with commands like:

- "Create a login page with email and password fields"
- "Design a dashboard with sidebar navigation"
- "Generate a product listing page with cards"

## Related Skills

- `/stitch-design-md` - Create DESIGN.md files documenting design systems
- `/stitch-react-components` - Convert Stitch designs to React components

## Troubleshooting

### Authentication Issues

If you already have gcloud configured, set the environment variable:
```bash
export STITCH_USE_SYSTEM_GCLOUD=1
```

### Environment Detection

The MCP server automatically detects WSL, SSH, Docker, and Cloud Shell environments.

## Resources

- [Stitch Documentation](https://stitch.withgoogle.com/docs/)
- [Stitch MCP GitHub](https://github.com/davideast/stitch-mcp)
- [Google MCP Servers](https://github.com/google/mcp)
