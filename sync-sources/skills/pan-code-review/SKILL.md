---
name: pan-code-review
description: Orchestrated parallel code review with automatic synthesis
triggers:
  - code review
  - review code
  - pan code review
  - parallel review
allowed-tools:
  - Task
  - Bash
  - Read
  - Write
  - Glob
  - Grep
---

# Pan Code Review

Orchestrates a comprehensive parallel code review using specialized review agents with automatic synthesis of findings.

## Overview

This skill coordinates three specialized review agents working in parallel:
- **Correctness Reviewer** - Logic errors, edge cases, type safety
- **Security Reviewer** - OWASP Top 10, vulnerabilities
- **Performance Reviewer** - Algorithms, N+1 queries, memory issues

After all three complete, a **Synthesis Agent** combines their findings into a unified, prioritized report.

## When to Use

Use this skill when you need a thorough code review:
- Before merging a pull request
- After implementing a new feature
- When refactoring critical code
- For security-sensitive changes
- When performance matters

## How It Works

```
User invokes /pan-code-review
    ↓
Determine scope (git diff, files, or pattern)
    ↓
Create .claude/reviews/ directory
    ↓
Spawn 3 parallel reviewers via Task tool:
    ├─→ correctness → writes .claude/reviews/<timestamp>-correctness.md
    ├─→ security    → writes .claude/reviews/<timestamp>-security.md
    └─→ performance → writes .claude/reviews/<timestamp>-performance.md
    ↓
Wait for all 3 to complete
    ↓
Spawn synthesis agent
    ↓
Synthesis reads all 3 reviews
    ↓
Synthesis writes .claude/reviews/<timestamp>-synthesis.md
    ↓
Present unified report to user
```

## Usage

### Review Uncommitted Changes

```bash
# Review all uncommitted changes (git diff)
/pan-code-review

# Same as above
/pan-code-review --scope diff
```

### Review Specific Files

```bash
# Review specific files
/pan-code-review --files "src/auth/*.ts"

# Review a single file
/pan-code-review --files "src/auth/auth-service.ts"

# Review multiple patterns
/pan-code-review --files "src/auth/*.ts,src/models/User.ts"
```

### Review a Branch

```bash
# Review all changes in current branch vs main
/pan-code-review --branch main

# Review vs specific branch
/pan-code-review --branch develop
```

### Review Options

```bash
# Focus on security only
/pan-code-review --focus security

# Focus on performance only
/pan-code-review --focus performance

# Focus on correctness only
/pan-code-review --focus correctness

# Skip synthesis (get raw reviews)
/pan-code-review --no-synthesis
```

## Implementation Guide

When this skill is invoked, you should:

### Step 1: Determine Scope

Parse user options or use defaults:

```typescript
// Default: review uncommitted changes
const scope = options.scope || 'diff';

if (scope === 'diff') {
  // Get uncommitted changes
  Bash: git diff --name-only
}

if (options.files) {
  // Use provided file pattern
  Glob: pattern=options.files
}

if (options.branch) {
  // Get changes vs branch
  Bash: git diff ${options.branch}...HEAD --name-only
}
```

### Step 2: Prepare Review Environment

```typescript
// Create reviews directory
Bash: mkdir -p .claude/reviews

// Generate timestamp for this review session
const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
// Example: 2026-01-20T15-30-00
```

### Step 3: Launch Parallel Reviewers

**IMPORTANT:** Spawn all three reviewers in a SINGLE message with multiple Task calls:

```typescript
// Spawn all 3 reviewers in parallel
Task({
  subagent_type: 'code-review-correctness',
  description: 'Review code correctness',
  prompt: `Review the following files for logic errors, edge cases, and type safety:

Files to review:
${fileList}

Write your findings to: .claude/reviews/${timestamp}-correctness.md

Follow the output format specified in your agent instructions.`
});

Task({
  subagent_type: 'code-review-security',
  description: 'Review code security',
  prompt: `Review the following files for security vulnerabilities (OWASP Top 10):

Files to review:
${fileList}

Write your findings to: .claude/reviews/${timestamp}-security.md

Follow the output format specified in your agent instructions.`
});

Task({
  subagent_type: 'code-review-performance',
  description: 'Review code performance',
  prompt: `Review the following files for performance issues:

Files to review:
${fileList}

Write your findings to: .claude/reviews/${timestamp}-performance.md

Follow the output format specified in your agent instructions.`
});
```

### Step 4: Wait for Completion

The Task tool is blocking - it waits for each agent to complete. Since you made 3 Task calls, all three will run in parallel and you'll get results when all complete.

### Step 5: Spawn Synthesis Agent

```typescript
Task({
  subagent_type: 'code-review-synthesis',
  description: 'Synthesize review findings',
  prompt: `Combine the findings from the three parallel code reviews.

Review files to read:
- .claude/reviews/${timestamp}-correctness.md
- .claude/reviews/${timestamp}-security.md
- .claude/reviews/${timestamp}-performance.md

Write your synthesis to: .claude/reviews/${timestamp}-synthesis.md

Provide a complete, prioritized report combining all findings.`
});
```

### Step 6: Present Results

```typescript
// Read the synthesis report
Read: file_path=`.claude/reviews/${timestamp}-synthesis.md`

// Display to user
console.log("Code Review Complete!");
console.log("");
console.log("Individual Reviews:");
console.log(`  - Correctness: .claude/reviews/${timestamp}-correctness.md`);
console.log(`  - Security:    .claude/reviews/${timestamp}-security.md`);
console.log(`  - Performance: .claude/reviews/${timestamp}-performance.md`);
console.log("");
console.log("Unified Report:");
console.log(`  - Synthesis:   .claude/reviews/${timestamp}-synthesis.md`);
console.log("");

// Display synthesis executive summary
[Display key findings from synthesis]
```

## Example Session

```
User: /pan-code-review --files "src/auth/*.ts"