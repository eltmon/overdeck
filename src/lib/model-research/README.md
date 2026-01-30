# Model Capability Research Framework

This directory contains tools for researching and updating model capability scores.

## Overview

The `model-capabilities.ts` file contains baseline capability scores for each model.
These scores should be periodically updated based on:

1. **Public benchmarks** - HumanEval, SWE-bench, MBPP, LMSYS Arena
2. **Community feedback** - Reddit, HN, Discord discussions
3. **Practical testing** - Running actual tasks through models

## Using Kimi 2.5 for Research

Kimi K2.5 can spawn subagents for deep research. Run the research prompt:

```bash
# Set up Kimi API
export ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic
export ANTHROPIC_AUTH_TOKEN=sk-kimi-YOUR_KEY

# Run research
claude < research-prompt.md
```

## Research Workflow

1. **Run research** - Execute research-prompt.md with Kimi
2. **Review findings** - Check research-output.json
3. **Update scores** - Modify model-capabilities.ts
4. **Test selection** - Run test-selection.ts to verify

## Files

- `research-prompt.md` - Prompt for Kimi 2.5 to research model capabilities
- `research-output.json` - Output from research (generated)
- `benchmark-sources.md` - List of benchmark sources to check
- `test-selection.ts` - Test script to verify selection works correctly
