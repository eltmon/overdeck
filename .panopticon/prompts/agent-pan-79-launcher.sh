#!/bin/bash
prompt=$(cat "/workspace/.panopticon/prompts/agent-pan-79.md")
exec claude --dangerously-skip-permissions --model claude-sonnet-4-5 "$prompt"
