---
name: benchmark
audience: both
description: >
  Create a benchmark issue to test Panopticon's agent pipeline. Creates a GitHub issue
  from a stored template with a scenario label for A/B comparison of models and approaches.
triggers:
  - benchmark
  - run benchmark
  - create benchmark
  - test pipeline
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Benchmark: QuantumLlama Provider Integration

## Overview

Creates a GitHub issue from the QuantumLlama benchmark template, appended with a scenario
description for A/B testing. The normal Panopticon pipeline (workspace creation, agent work,
review, test) then exercises the full system. Results (cost, tokens, quality) are tracked
per-workspace for comparison across runs.

## When to Use

- User wants to benchmark Panopticon's agent pipeline
- User wants to compare model performance (e.g., Opus vs Sonnet vs OpenAI)
- User wants to measure token consumption and cost for a feature implementation
- User says `/benchmark <scenario description>`

## Usage

```
/benchmark <scenario description>
```

**Examples:**
- `/benchmark Opus 4.6 baseline`
- `/benchmark All OpenAI models`
- `/benchmark Sonnet 4.6 with TLDR enabled`
- `/benchmark Haiku fast mode, no planning`

## What This Does

1. Reads the issue template from `benchmarks/templates/quantumllama.md`
2. Creates a GitHub issue titled: `Benchmark: QuantumLlama — <scenario description>`
3. Labels it with `benchmark` (creates the label if it doesn't exist)
4. Reports the issue number so the user can proceed with `pan issue PAN-XXX`

## Execution Steps

### Step 1: Get the scenario description

The scenario description is the argument passed after `/benchmark`. If no argument
was provided, ask the user:

> What scenario are you testing? (e.g., "Opus 4.6 baseline", "All OpenAI models")

### Step 2: Read the template

```bash
cat /home/eltmon/Projects/panopticon-cli/benchmarks/templates/quantumllama.md
```

### Step 3: Ensure the `benchmark` label exists

```bash
cd /home/eltmon/Projects/panopticon-cli && gh label create benchmark --description "Synthetic benchmark issue" --color "7B61FF" --force
```

### Step 4: Create the issue

Create a GitHub issue on `eltmon/panopticon-cli` with:
- **Title**: `Benchmark: QuantumLlama — <scenario description>`
- **Label**: `benchmark`
- **Body**: The content from the template file

```bash
cd /home/eltmon/Projects/panopticon-cli && gh issue create \
  --title "Benchmark: QuantumLlama — <SCENARIO>" \
  --label "benchmark" \
  --body "$(cat benchmarks/templates/quantumllama.md)"
```

### Step 5: Report result

Tell the user the issue number and how to run it:

```
Created PAN-XXX: Benchmark: QuantumLlama — <scenario>

To run the benchmark:
  pan issue PAN-XXX
```

## Important Notes

- **Never merge** benchmark branches — they exist only for measurement
- Each run creates a separate issue + workspace, making A/B comparison straightforward
- Cost and token data are tracked automatically by Panopticon per-workspace
- Clean up old benchmark workspaces with `pan workspace delete` when done comparing
- The spec file at `benchmarks/specs/quantumllama.md` is referenced in the issue body —
  the agent reads it during implementation
