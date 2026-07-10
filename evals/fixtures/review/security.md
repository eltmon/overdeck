# Security Reviewer Report — cycle 1

## Summary
One blocker found inside the PR diff. Demote nothing.

## Findings

### ! Auth bypass on the prompt surface

- **Severity:** `!` (blocker)
- **Location:** `src/lib/cloister/prompts/work.md:42`
- **Evidence:** The new code lets a user-supplied header override the role gate without
  re-checking the allowlist. A third-party issue body could embed an override and the
  prompt would honor it.
- **Suggested fix:** Re-apply the allowlist after the header substitution step.

No other findings. Cycle 1, head SHA `deadbeef`.