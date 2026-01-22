# Contributing to Panopticon

Thank you for your interest in contributing to Panopticon! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to build great tools.

## Getting Started

### Prerequisites

- Node.js 18+
- tmux
- Git

### Development Setup

```bash
# Clone the repository
git clone https://github.com/eltmon/panopticon-cli.git
cd panopticon-cli

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode (with hot reload)
npm run dev
```

### Project Structure

```
panopticon/
├── src/
│   ├── cli/              # CLI commands
│   │   ├── commands/     # Individual command implementations
│   │   └── index.ts      # CLI entry point
│   ├── lib/              # Shared libraries
│   │   ├── agents.ts     # Agent management
│   │   ├── health.ts     # Health monitoring
│   │   ├── hooks.ts      # FPP hooks
│   │   └── paths.ts      # Path constants
│   ├── dashboard/        # Web dashboard
│   │   ├── frontend/     # React frontend
│   │   └── server/       # Express API server
│   └── index.ts          # Library exports
├── dist/                 # Compiled output
└── templates/            # CLAUDE.md templates
```

## Development Workflow

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following our coding standards

3. Build and test:
   ```bash
   npm run build
   npm run typecheck
   ```

4. Test your changes manually:
   ```bash
   node dist/cli/index.js --help
   node dist/cli/index.js doctor
   ```

5. Commit with a clear message:
   ```bash
   git commit -m "feat: add new feature description"
   ```

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `refactor:` - Code change that neither fixes a bug nor adds a feature
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Examples:
```
feat: add convoy command for parallel agents
fix: handle missing LINEAR_API_KEY gracefully
docs: update README with new commands
refactor: extract health check logic to separate module
```

## Coding Standards

### TypeScript

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use explicit return types for public functions
- Use interfaces for object shapes

```typescript
// Good
export interface AgentConfig {
  id: string;
  model: 'sonnet' | 'opus' | 'haiku';
  timeout: number;
}

export function createAgent(config: AgentConfig): Agent {
  // ...
}

// Avoid
export function createAgent(config: any) {
  // ...
}
```

### Error Handling

- Always handle errors gracefully
- Provide helpful error messages
- Don't expose internal details in user-facing errors

```typescript
// Good
if (!apiKey) {
  console.log(chalk.red('LINEAR_API_KEY not configured'));
  console.log(chalk.dim('Add it to ~/.panopticon.env or set as environment variable'));
  return;
}

// Avoid
if (!apiKey) throw new Error('No key');
```

### CLI Output

- Use `chalk` for colored output
- Use icons consistently: ✓ (success), ✗ (error), ⚠ (warning)
- Keep output concise and actionable

```typescript
console.log(chalk.green('✓ Agent started successfully'));
console.log(chalk.red('✗ Failed to connect'));
console.log(chalk.yellow('⚠ No agents running'));
console.log(chalk.dim('Hint: use pan work issue <id> to start one'));
```

## Security

### Never Commit Secrets

- Never hardcode API keys, tokens, or credentials
- Use environment variables or `~/.panopticon.env`
- Use placeholder examples in documentation: `lin_api_xxxxx`

### Before Submitting

Run this check to ensure no secrets are committed:

```bash
# Check for potential secrets
grep -r "api_key\|token\|password\|secret" --include="*.ts" src/ | grep -v "process.env\|getLinearApiKey\|xxxxx"
```

## Adding New Commands

### CLI Command

1. Create a new file in `src/cli/commands/`:

```typescript
// src/cli/commands/mycommand.ts
import chalk from 'chalk';

export async function myCommand(options: MyOptions): Promise<void> {
  console.log(chalk.bold('My Command'));
  // Implementation
}
```

2. Register in `src/cli/index.ts`:

```typescript
import { myCommand } from './commands/mycommand.js';

program
  .command('mycommand')
  .description('Description of my command')
  .option('--flag', 'Description of flag')
  .action(myCommand);
```

### Adding a Skill

1. Create a directory in `~/.panopticon/skills/`:

```bash
mkdir ~/.panopticon/skills/my-skill
```

2. Create `SKILL.md`:

```markdown
---
name: my-skill
description: Brief description (under 500 chars for Codex compatibility)
---

# My Skill

Instructions for the AI agent...
```

3. Update `~/.panopticon/skills/index.json` with the new skill metadata.

## Testing

Currently, manual testing is the primary method:

```bash
# Build
npm run build

# Test commands
node dist/cli/index.js doctor
node dist/cli/index.js skills
node dist/cli/index.js sync --dry-run
```

We welcome contributions to add automated tests!

## Pull Request Process

1. Ensure your code builds without errors
2. Update documentation if needed
3. Add your changes to the PR description
4. Request review from maintainers

### PR Title Format

Use the same format as commit messages:
```
feat: add convoy command for parallel agents
```

## Questions?

Open an issue on GitHub for questions or discussions.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
