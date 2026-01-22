# PAN-19: pan up: Dashboard fails to start - spawn npm ENOENT

## Issue Summary

Running `pan up` fails on macOS with `spawn npm ENOENT` error. This affects users with nvm-managed Node.js installations where the npm binary path isn't resolved correctly when spawning child processes.

**GitHub Issue:** https://github.com/eltmon/panopticon-cli/issues/19

## Root Cause Analysis

**Problem Location:** `src/cli/index.ts` lines 145 and 170

```typescript
const child = spawn('npm', ['run', 'dev'], {
  cwd: dashboardDir,
  stdio: 'inherit',  // or 'ignore' for detached mode
});
```

**Why it fails:**
1. `spawn()` without `shell: true` uses `execvp()` to resolve the command
2. On macOS with nvm, npm lives in `~/.nvm/versions/node/v20.x.x/bin/npm`
3. The nvm PATH is set up by shell initialization scripts (`.bashrc`/`.zshrc`)
4. When Node.js spawns a process without a shell, it may not have the nvm PATH
5. Result: `ENOENT` - npm not found

**Evidence from GitHub issue comment:**
```
$ which npm
/Users/edward.becker/.nvm/versions/node/v20.19.5/bin/npm

$ npm list -g panopticon-cli
└── panopticon-cli@0.3.2
```
npm IS in the shell PATH, but `spawn('npm', ...)` fails.

## Key Decisions

### 1. Fix Approach: Use `shell: true`

**Decision:** Add `shell: true` to both spawn calls (foreground and background modes)

**Rationale:**
- Simplest fix with minimal code change
- Makes spawn use the shell to resolve npm, which will have the full PATH including nvm
- Cross-platform compatible (works on Windows, macOS, Linux)
- Pattern already used elsewhere in the codebase (e.g., `execSync` calls)

**Alternative considered:** Resolve npm path explicitly via `process.execPath`. More robust but adds complexity and edge cases.

### 2. Add Pre-flight Check for npm

**Decision:** Verify npm is accessible before attempting to spawn

**Implementation:**
- Use existing `checkCommand()` pattern from `install.ts` and `doctor.ts`
- Run `which npm` (or equivalent) before spawn
- Provide clear error message if npm is not found

### 3. Add Error Handling for Background Mode

**Decision:** Add error handler for detached spawn before calling `unref()`

**Current problem:** Lines 145-150 spawn in background with no error handling:
```typescript
const child = spawn('npm', ['run', 'dev'], {
  cwd: dashboardDir,
  detached: true,
  stdio: 'ignore',
});
child.unref();  // Errors are lost!
```

**Fix:** Add error listener that fires before unref or use a small delay to catch immediate spawn errors.

## Scope

### In Scope
- Fix the `spawn npm ENOENT` error by adding `shell: true`
- Add npm existence check before spawning
- Add error handling for background spawn mode
- Test on macOS and Linux

### Out of Scope
- Windows-specific fixes (though `shell: true` should help there too)
- Changes to other spawn calls in the codebase
- Refactoring the dashboard startup logic

## Implementation Plan

### Files to Modify

**Primary:** `src/cli/index.ts`
- Lines 145-150: Background spawn (--detach mode)
- Lines 170-178: Foreground spawn

### Code Changes

**1. Add npm check helper (before line 140):**
```typescript
async function checkNpmExists(): Promise<boolean> {
  try {
    execSync('npm --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
```

**2. Pre-flight check (before line 141):**
```typescript
// Check npm is available
if (!await checkNpmExists()) {
  console.error(chalk.red('Error: npm not found in PATH'));
  console.error(chalk.dim('Make sure Node.js and npm are installed and in your PATH'));
  process.exit(1);
}
```

**3. Fix background spawn (lines 145-150):**
```typescript
const child = spawn('npm', ['run', 'dev'], {
  cwd: dashboardDir,
  detached: true,
  stdio: 'ignore',
  shell: true,  // ADD THIS
});

// Handle spawn errors before unref
child.on('error', (err) => {
  console.error(chalk.red('Failed to start dashboard in background:'), err.message);
  process.exit(1);
});

// Small delay to catch immediate spawn errors
setTimeout(() => {
  child.unref();
  console.log(chalk.green('✓ Dashboard started in background'));
  // ... rest of output
}, 100);
```

**4. Fix foreground spawn (lines 170-173):**
```typescript
const child = spawn('npm', ['run', 'dev'], {
  cwd: dashboardDir,
  stdio: 'inherit',
  shell: true,  // ADD THIS
});
```

## Testing Plan

1. **Manual test on macOS with nvm:**
   - Install panopticon-cli globally
   - Run `pan up` - should start dashboard
   - Run `pan up --detach` - should start in background

2. **Manual test on Linux (WSL2):**
   - Same tests as above
   - Verify no regressions

3. **Test npm not found scenario:**
   - Temporarily modify PATH to exclude npm
   - Verify clear error message is shown

## Success Criteria

1. `pan up` works on macOS with nvm-managed Node.js
2. `pan up --detach` works and shows proper error if spawn fails
3. Clear error message when npm is not found
4. No regressions on Linux

## Beads Tasks

| ID | Title | Status | Blocked By |
|----|-------|--------|------------|
| panopticon-324n | Add shell: true to foreground spawn | open | - |
| panopticon-rsb1 | Add shell: true to background spawn | open | - |
| panopticon-qdu3 | Add npm pre-flight check | open | - |
| panopticon-pxqm | Add error handling for background spawn | open | panopticon-rsb1 |
| panopticon-zppl | Test on macOS with nvm | open | 324n, rsb1, qdu3, pxqm |
| panopticon-nnic | Test on Linux (verify no regression) | open | 324n, rsb1 |

## References

- GitHub Issue: https://github.com/eltmon/panopticon-cli/issues/19
- Source file: `src/cli/index.ts` lines 87-180
- Similar pattern: `src/cli/commands/install.ts` `checkCommand()` function
- Similar pattern: `src/cli/commands/doctor.ts` `checkCommand()` function
