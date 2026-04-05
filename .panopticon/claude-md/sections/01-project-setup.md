## Package Manager: Bun

This project uses **Bun** for dependency management. The lockfile is `bun.lock`.

```bash
# Install dependencies (NEVER use npm install)
bun install

# Add a dependency
bun add <package>
bun add -d <package>  # dev dependency
```

Use `npm run` / `npm test` for script execution (works fine with bun-installed deps), but **NEVER use `npm install`** — it creates a `package-lock.json` and installs differently.

## Build & Test

```bash
npm run build      # tsdown for CLI/server/contracts, Vite for frontend
npm run typecheck   # TypeScript strict mode
npm run lint        # ESLint
npm test -- --run   # Vitest
```

## Stack

- TypeScript, Node.js 22+, Effect.js server, React dashboard, SQLite
- Build: tsdown (CLI, server, contracts), Vite (frontend)
- Bun workspaces: `packages/contracts`, `src/dashboard/server`, `src/dashboard/frontend`
