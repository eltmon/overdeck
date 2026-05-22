# Output Patterns for Skills

## Structured Report
```markdown
## Analysis Report

### Summary
[One-paragraph overview]

### Findings
| Category | Count | Severity |
|----------|-------|----------|
| Critical | X     | High     |
| Warning  | Y     | Medium   |
| Info     | Z     | Low      |

### Details
[Detailed breakdown by category]

### Recommendations
1. [Action item 1]
2. [Action item 2]
```

## Checklist Output
```markdown
## Review Checklist

- [x] Item completed
- [ ] Item pending
- [ ] Item blocked (reason: X)

**Status**: 2/3 complete
```

## Code Generation
```markdown
## Generated Code

\`\`\`typescript
// File: src/components/MyComponent.tsx
// Purpose: [description]

[generated code here]
\`\`\`

### Usage
\`\`\`typescript
import { MyComponent } from './MyComponent';
// Example usage
\`\`\`
```

## Diff/Change Summary
```markdown
## Changes Made

### Files Modified
- `src/foo.ts` - Added validation logic
- `src/bar.ts` - Fixed null handling

### Summary
- 2 files changed
- 15 insertions(+)
- 3 deletions(-)
```

## Decision Matrix
```markdown
## Option Analysis

| Criteria       | Option A | Option B | Option C |
|----------------|----------|----------|----------|
| Complexity     | Low      | Medium   | High     |
| Performance    | Good     | Best     | Good     |
| Maintainability| Best     | Good     | Fair     |

**Recommendation**: Option A for simplicity, Option B if performance critical.
```

## Progress Update
```markdown
## Progress Report

**Current Phase**: Implementation
**Overall Progress**: 60%

### Completed
- [x] Design
- [x] Setup

### In Progress
- [ ] Implementation (3/5 tasks done)

### Remaining
- [ ] Testing
- [ ] Documentation
```

## Error Report
```markdown
## Error Analysis

### Error
\`\`\`
[Error message]
\`\`\`

### Location
File: `src/foo.ts:42`

### Cause
[Explanation of root cause]

### Fix
[Specific steps to resolve]
```

## API Documentation
```markdown
## Function: processData

### Signature
\`\`\`typescript
function processData(input: InputType, options?: Options): Promise<Result>
\`\`\`

### Parameters
| Name    | Type      | Required | Description |
|---------|-----------|----------|-------------|
| input   | InputType | Yes      | Data to process |
| options | Options   | No       | Processing options |

### Returns
`Promise<Result>` - The processed data

### Example
\`\`\`typescript
const result = await processData(myInput, { verbose: true });
\`\`\`
```
