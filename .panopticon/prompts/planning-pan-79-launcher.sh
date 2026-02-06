#!/bin/bash
# Set terminal environment for proper rendering
export TERM=xterm-256color
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export COLORTERM=truecolor

cd /workspace
prompt=$(cat "/workspace/.panopticon/prompts/planning-pan-79.txt")
exec claude --dangerously-skip-permissions --model claude-opus-4-5 "$prompt"
