# Workflow Patterns for Skills

## Sequential Workflow
```markdown
## Process
1. **Validate inputs** - Check all required fields present
2. **Transform data** - Apply business logic
3. **Generate output** - Create result in specified format
4. **Verify result** - Confirm output meets requirements
```

## Conditional Branching
```markdown
## Decision Tree

If user requests X:
1. Do A
2. Then B

If user requests Y:
1. Do C instead
2. Skip B

Always finish with Z regardless of path.
```

## Read-Process-Write Pattern
```markdown
## Data Transformation

1. **Read** the input file using Read tool
2. **Process** according to transformation rules:
   - Rule 1: Convert X to Y
   - Rule 2: Remove Z
3. **Write** result to output location
```

## Search-Analyze-Report Pattern
```markdown
## Investigation Flow

1. **Search** using Grep for patterns matching criteria
2. **Analyze** each match by reading surrounding context
3. **Report** findings in structured format:
   - Summary of findings
   - Specific locations
   - Recommended actions
```

## Wizard Pattern (Multi-Step with Confirmation)
```markdown
## Setup Wizard

### Phase 1: Configuration
Gather initial settings from user.
Ask: "What is your preferred X?"

### Phase 2: Validation
Verify configuration is valid.
Show summary and ask: "Does this look correct?"

### Phase 3: Execution
Only proceed after user confirms.
Execute the configured operation.
```

## Parallel Research Pattern
```markdown
## Multi-Source Research

Gather information from multiple sources simultaneously:
1. Search codebase for pattern X
2. Check documentation for Y
3. Review tests for Z

Synthesize findings into unified recommendation.
```

## Error Recovery Pattern
```markdown
## Robust Execution

Try primary approach:
1. Attempt operation A
2. If fails with error X, try fallback B
3. If still fails, report to user with:
   - What was attempted
   - What failed
   - Suggested manual steps
```
