# PAN-142: Consolidate to Claude Code Only - Remove Multi-Runtime Support

## Context

Panopticon was originally designed to support multiple AI coding tools (Claude Code, Codex, Cursor, Gemini, OpenCode) with a unified sync system. This added significant complexity:

- Multiple sync targets in `paths.ts`
- Runtime adapters for each tool (`src/lib/runtime/`)
- Separate runtime types in Cloister system (`src/lib/runtimes/`)
- CLI flags for runtime selection
- Complex config management

**Decision**: Consolidate to Claude Code as the sole AI coding tool, with `claude-code-router` handling alternative model selection.

## Scope of Work

### 1. Remove Sync Targets and Runtime Adapters

#### Files to Modify:
- **`src/lib/paths.ts`**
  - Remove: `CODEX_DIR`, `CURSOR_DIR`, `GEMINI_DIR`, `OPENCODE_DIR` constants
  - Simplify: `SYNC_TARGETS` to only include `claude` entry
  - Keep: `CLAUDE_DIR` and claude sync target
  - Update: `Runtime` type to `type Runtime = 'claude';`

- **`src/lib/sync.ts`**
  - Simplify: `planSync()` and `executeSync()` - no longer need to validate runtime
  - Keep: Core sync logic for skills/commands/agents
  - Consider: Since there's only one target, could hardcode to 'claude' or still accept parameter for future extensibility

- **`src/cli/commands/sync.ts`**
  - Remove: Runtime loop (lines 70-178) - no longer iterate over targets
  - Simplify: Always sync to claude only
  - Update: User-facing messages to not mention multiple targets
  - Keep: Backup, dry-run, force flags
  - Keep: Hooks sync and git hooks sync (unrelated to runtime targets)

#### Files to Remove:
- **`src/lib/runtime/codex.ts`** - Delete entirely
- **`src/lib/runtime/cursor.ts`** - Delete entirely
- **`src/lib/runtime/gemini.ts`** - Delete entirely
- **`src/lib/runtime/index.ts`** - Check if only exports removed adapters; if so, delete entirely

### 2. Consolidate Cloister Runtime System

The Cloister system (specialist agent management) has a separate runtime abstraction in `src/lib/runtimes/` that currently supports multiple runtimes.

#### Files to Modify:
- **`src/lib/runtimes/types.ts`**
  - Change: `type RuntimeName = 'claude-code' | 'opencode' | 'codex';`
  - To: `type RuntimeName = 'claude-code';`

- **`src/lib/runtimes/index.ts`**
  - Remove: Case statements for 'opencode' and 'codex' (lines 68-73)
  - Simplify: Runtime mapping logic since there's only one option

- **`src/lib/cloister/*.ts`** (if needed)
  - Check all files importing RuntimeName
  - Update any logic that assumes multiple runtimes

### 3. Remove CLI Runtime Selection

#### Files to Modify:
- **`src/cli/commands/work/index.ts`**
  - Remove: `--runtime` flag option (line 33)
  - Remove: Any logic that uses the runtime parameter
  - Update: Help text and examples

### 4. Config Migration

#### Files to Modify:
- **`src/lib/config.ts`**
  - Remove: `targets: string[]` from `sync` config interface (line 86)
  - Simplify: Config type since sync always targets claude
  - Decision: Keep or remove the entire `targets` field?
    - **Recommended**: Remove entirely - no need to configure what's hardcoded

- **`src/lib/config-migration.ts`**
  - Add: Migration logic to handle old configs with `[sync].targets`
  - Behavior: Strip out targets field, warn if non-claude targets were configured

#### New Functionality:
- **Symlink Cleanup Migration**
  - On first run after upgrade, detect and remove Panopticon-managed symlinks from:
    - `~/.opencode/skills/`, `~/.opencode/commands/`, `~/.opencode/agents/`
    - `~/.codex/skills/`, `~/.codex/commands/`, `~/.codex/agents/`
    - `~/.cursor/skills/`, `~/.cursor/commands/`, `~/.cursor/agents/`
    - `~/.gemini/skills/`, `~/.gemini/commands/`, `~/.gemini/agents/`
  - Use existing `isPanopticonSymlink()` helper from `sync.ts`
  - Log cleanup actions to user
  - **Where to implement**:
    - Option A: Add to config migration (`config-migration.ts`)
    - Option B: Add to sync command with auto-run flag
    - **Recommended**: Add to config migration since it's a one-time upgrade task

### 5. Update Tests

#### Files to Modify:
- **`tests/integration/cli/sync.test.ts`**
  - Remove: Multi-target tests
  - Update: Mock to only include claude
  - Verify: Symlink creation still works correctly

- **`tests/fixtures/config.toml`**
  - Change: `targets = ["claude", "codex"]`
  - To: Remove targets field entirely OR `targets = ["claude"]` depending on final config design

- **Other test files**: Search for references to codex/cursor/gemini/opencode and update

### 6. Update Documentation

#### Files to Modify:
- **`docs/PRD.md`**
  - Remove: Multi-runtime examples (lines 1522, 1537, 1541)
  - Update: Sync documentation to reflect claude-only

- **`docs/PRD-CLOISTER.md`**
  - Remove: opencode from complexity_routing example (line 592-593)
  - Update: Agent runtime examples to only show claude-code

- **`docs/CONFIGURATION.md`** (if exists)
  - Update: Sync configuration examples

- **`README.md`** (if exists)
  - Update: Any multi-runtime references

### 7. Skills Documentation

#### Files to Check:
- **`skills/pan-sync/SKILL.md`**
- **`skills/pan-setup/SKILL.md`**
- **`skills/pan-config/SKILL.md`**
- Update any references to multiple runtimes or sync targets

## Technical Decisions

### 1. Keep or Remove Runtime Parameter?

**Decision**: **Remove** the Runtime type parameter entirely from sync functions.

**Rationale**:
- There's only one target, so no need to parameterize
- Simplifies the API
- Prevents confusion about extensibility
- If we ever need multi-runtime again, we can add it back

**Alternative Considered**:
- Keep Runtime type as `type Runtime = 'claude';` for future extensibility
- Rejected: YAGNI principle - adds complexity for hypothetical future needs

### 2. Config Migration Strategy

**Decision**: **Remove** `[sync].targets` field entirely from config schema.

**Rationale**:
- No user configuration needed for a hardcoded value
- Simplifies config schema and validation
- Clear migration path: strip field if present, warn if non-default

**Migration Behavior**:
```typescript
// Old config:
[sync]
targets = ["claude", "codex"]

// New config (auto-migrated):
[sync]
# targets field removed - always syncs to Claude Code
```

### 3. Symlink Cleanup Approach

**Decision**: Auto-cleanup during config migration with user notification.

**Implementation**:
```typescript
// In config-migration.ts
export function cleanupLegacyRuntimeSymlinks(): CleanupResult {
  const runtimeDirs = [
    { name: 'opencode', base: OPENCODE_DIR },
    { name: 'codex', base: CODEX_DIR },
    { name: 'cursor', base: CURSOR_DIR },
    { name: 'gemini', base: GEMINI_DIR },
  ];

  const cleaned: string[] = [];

  for (const { name, base } of runtimeDirs) {
    for (const subdir of ['skills', 'commands', 'agents']) {
      const dir = join(base, subdir);
      if (!existsSync(dir)) continue;

      const entries = readdirSync(dir);
      for (const entry of entries) {
        const path = join(dir, entry);
        if (isPanopticonSymlink(path)) {
          unlinkSync(path);
          cleaned.push(`${name}/${subdir}/${entry}`);
        }
      }
    }
  }

  return { cleaned, total: cleaned.length };
}
```

### 4. Cloister Runtime Consolidation

**Decision**: Simplify RuntimeName to only 'claude-code'.

**Rationale**:
- All model selection handled by claude-code-router
- No need for runtime selection at agent spawn time
- Simplifies Cloister's agent management

**Impact**:
- Cloister config files that specify `runtime: opencode` or `runtime: codex` will need updates
- Migration should default unknown runtimes to 'claude-code'

## Dependencies

### Beads Task Dependencies
1. **Remove sync targets** (paths.ts, sync.ts) - No dependencies
2. **Remove runtime adapters** (src/lib/runtime/) - Depends on #1
3. **Simplify sync command** (cli/commands/sync.ts) - Depends on #1
4. **Update Cloister runtime** (runtimes/types.ts) - No dependencies
5. **Remove CLI runtime flag** (cli/commands/work/) - No dependencies
6. **Config migration** (config.ts, config-migration.ts) - Depends on #1
7. **Symlink cleanup** (config-migration.ts) - Depends on #1
8. **Update tests** - Depends on #1-#7
9. **Update documentation** - Can be done in parallel

## Acceptance Criteria

- [ ] Only `claude` sync target remains in codebase
- [ ] `CODEX_DIR`, `CURSOR_DIR`, `GEMINI_DIR`, `OPENCODE_DIR` removed from paths.ts
- [ ] Runtime adapter files (codex.ts, cursor.ts, gemini.ts) deleted
- [ ] `RuntimeName` type in Cloister only includes 'claude-code'
- [ ] `--runtime` flag removed from CLI commands
- [ ] Config migration strips `[sync].targets` field
- [ ] Symlink cleanup removes Panopticon-managed links in legacy runtime dirs
- [ ] All tests pass with updated fixtures
- [ ] Documentation updated to reflect claude-only approach
- [ ] No references to codex/cursor/gemini/opencode in codebase (except in comments explaining removal)

## Risks and Mitigations

### Risk: Existing users have non-claude configs
**Mitigation**: Config migration with clear warning message

### Risk: Breaking change for existing workflows
**Mitigation**: This is a deliberate breaking change. Version bump to indicate breaking change, clear changelog entry

### Risk: Orphaned symlinks cause issues
**Mitigation**: Auto-cleanup during migration, log all cleanup actions

### Risk: Cloister configs reference removed runtimes
**Mitigation**: Default unknown runtimes to 'claude-code', log warning

## Testing Strategy

### Unit Tests
- Test config migration handles old targets gracefully
- Test symlink cleanup only removes Panopticon-managed links
- Test RuntimeName type changes compile correctly

### Integration Tests
- Test sync command with simplified flow
- Test agent spawning with only claude-code runtime
- Test config loading with and without targets field

### Manual Testing
- Test upgrade path with existing config.toml
- Verify symlink cleanup doesn't remove user files
- Test sync command UI/UX with simplified output

## Rollout Plan

1. **Version**: Bump to next minor version (e.g., 0.5.0) due to breaking changes
2. **Changelog**: Document removal of multi-runtime support, point to claude-code-router
3. **Migration**: Auto-run on first `pan sync` or `pan setup` after upgrade
4. **Documentation**: Update README with clear migration guide

## Notes

- This is a **breaking change** for users who configured multiple sync targets
- Alternative model selection is now handled by [claude-code-router](https://github.com/musistudio/claude-code-router)
- The crash fixed in `843ad26` (opencode in config but not in SYNC_TARGETS) is fully resolved by this change
