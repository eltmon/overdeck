# Panopticon Documentation Style Guide

Markdown conventions and formatting standards for Panopticon documentation.

## General Principles

1. **Clarity over cleverness** - Write to be understood, not to impress
2. **Consistency** - Follow existing patterns in the file you're editing
3. **Progressive disclosure** - Start simple, add depth with links
4. **Code-first examples** - Show working code, then explain

## Markdown Conventions

### Headings

```markdown
# H1 - Document Title (one per file)

## H2 - Major Sections

### H3 - Subsections

#### H4 - Rarely needed, use for deep nesting only
```

**Rules**:
- One H1 per document (the title)
- Use H2 for major sections
- Don't skip levels (H2 → H4)
- Add blank line before and after headings

### Code Blocks

**Always specify language:**

```markdown
```bash
npm install
```​

```typescript
interface Config {
  preset: string;
}
```​

```yaml
models:
  preset: balanced
```​
```

**Supported languages**: bash, typescript, javascript, yaml, json, python, markdown

**Inline code**: Use backticks for `variable names`, `commands`, and `file.paths`

### Lists

**Unordered lists** (use `-` not `*`):
```markdown
- First item
- Second item
  - Nested item
  - Another nested item
- Third item
```

**Ordered lists**:
```markdown
1. First step
2. Second step
3. Third step
```

**Definition lists** (use tables):
```markdown
| Term | Definition |
|------|------------|
| API Key | Authentication token for API access |
| Preset | Pre-configured model selection strategy |
```

### Tables

**Format**:
```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Value A  | Value B  | Value C  |
| Value D  | Value E  | Value F  |
```

**Alignment**:
```markdown
| Left | Center | Right |
|:-----|:------:|------:|
| A    |   B    |     C |
```

**Use tables for**:
- Comparison matrices
- Configuration options
- File indexes
- Command references

### Links

**Internal links** (within repo):
```markdown
See [WORK-TYPES.md](./WORK-TYPES.md) for details.
```

**External links**:
```markdown
Read the [official documentation](https://example.com).
```

**Reference-style** (for repeated links):
```markdown
See the [API docs][api] and [configuration guide][config].

[api]: https://example.com/api
[config]: https://example.com/config
```

### Emphasis

- **Bold** for emphasis: `**important**`
- *Italic* for definitions: `*term*`
- `Code` for technical terms: `` `variable` ``
- ~~Strikethrough~~ for deprecated: `~~old~~`

### Admonitions

Use blockquotes with emoji for callouts:

```markdown
> ⚠️ **Warning**: This is a critical warning.

> 💡 **Tip**: Helpful suggestion here.

> ❌ **Don't**: Bad practice to avoid.

> ✅ **Do**: Good practice to follow.

> 📝 **Note**: Additional information.
```

**Standard emoji**:
- ⚠️ Warning / Critical
- 💡 Tip / Suggestion
- ❌ Don't / Bad Practice
- ✅ Do / Good Practice
- 📝 Note / Information
- 🚀 Quick Start / Getting Started
- 🔧 Configuration / Setup

## Document Structure

### README.md Pattern

```markdown
# Project Name

Brief one-sentence description.

## Features

- Feature 1
- Feature 2
- Feature 3

## Installation

```bash
npm install
```​

## Quick Start

```bash
# Example command
npm start
```​

## Usage

...

## Documentation

- [Configuration Guide](docs/CONFIGURATION.md)
- [API Reference](docs/API.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
```

### Configuration Guide Pattern

```markdown
# Configuration Guide

Brief overview of what can be configured.

## Table of Contents

- [Section 1](#section-1)
- [Section 2](#section-2)

## Quick Start

Minimal working example:

```bash
# Quick setup
...
```​

## Section 1

Detailed explanation with examples.

### Subsection

More details.

## Examples

### Example 1: Description

```bash
# Code example
```​

### Example 2: Description

```bash
# Code example
```​
```

### API Documentation Pattern

```markdown
# API Reference

## Function Name

**Description**: What it does.

**Parameters**:
- `param1` (string): Description
- `param2` (number, optional): Description

**Returns**: Return type and description

**Example**:
```typescript
const result = functionName('value', 42);
```​

**Throws**:
- `Error`: When this happens
```

## File-Specific Conventions

### CLAUDE.md

- Use H2 for major policies (## NEVER Defer Work)
- Include checkboxes for checklists
- Use code blocks for command examples
- Emphasize with **bold** for critical points
- Use ❌ and ✅ for do/don't examples

### CONFIGURATION.md

- Start with Table of Contents
- Use tables for option matrices
- Include multiple examples
- Show full config file examples
- Link to related docs

### README.md

- Keep it concise (under 300 lines if possible)
- Use badges for build status, version, etc.
- Include quick start that works immediately
- Link to detailed docs for everything else

## Code Examples

### Bash Examples

```markdown
```bash
# Comment explaining the command
npm install --save-dev package-name

# Multi-line with continuation
export ANTHROPIC_BASE_URL=https://api.example.com \
  && export ANTHROPIC_AUTH_TOKEN=token \
  && claude
```​
```

### TypeScript Examples

```markdown
```typescript
// Type-annotated function
function processConfig(config: Config): Result {
  // Implementation
  return result;
}

// Usage example
const config: Config = {
  preset: 'balanced',
  providers: { anthropic: true }
};
const result = processConfig(config);
```​
```

### YAML Examples

```markdown
```yaml
# Configuration file
models:
  preset: balanced  # Comment explaining the option

  overrides:
    issue-agent:implementation: gpt-5.2-codex
```​
```

## Formatting Rules

### Line Length

- Prefer 80-100 characters per line for prose
- Code blocks can be wider if needed
- Break long URLs onto their own line

### Whitespace

- One blank line between paragraphs
- One blank line before/after headings
- One blank line before/after code blocks
- One blank line before/after tables
- No trailing whitespace

### File Endings

- Always end files with a single newline
- No blank lines at end of file (just one newline)

## Documentation Checklist

Before committing documentation changes:

```
[ ] Spell-check completed
[ ] Code examples tested and working
[ ] Internal links verified (files exist)
[ ] External links checked (not broken)
[ ] Consistent heading hierarchy
[ ] Table of contents updated (if present)
[ ] No trailing whitespace
[ ] File ends with single newline
[ ] Follows existing style in the file
```

## Tools

### Spell Check
```bash
# Use aspell or your editor's spell checker
aspell check docs/CONFIGURATION.md
```

### Markdown Linting
```bash
# Install markdownlint
npm install -g markdownlint-cli

# Check file
markdownlint docs/CONFIGURATION.md
```

### Link Checking
```bash
# Check for broken internal links
grep -r "](\./" docs/ | grep -v "node_modules"
```
