# PAN-18: pan sync TypeError - STATE

## Issue Summary

`pan sync` fails with `TypeError: Cannot read properties of undefined (reading 'length')` because `config.sync.targets` is undefined.

## Root Cause Analysis

**Primary cause:** `pan install` creates a config.toml with an incomplete `[sync]` section - it's missing the `targets` array.

**Secondary cause:** `loadConfig()` in config.ts uses shallow merging (`{ ...DEFAULT_CONFIG, ...parsed }`), which replaces entire nested objects instead of merging their properties.

**Flow:**
1. User runs `pan install` - creates config without `targets` in `[sync]` section
2. User runs `pan sync` - loads config, shallow merge occurs
3. User's `sync` object (without `targets`) replaces `DEFAULT_CONFIG.sync`
4. `config.sync.targets` is `undefined`
5. `targets.length` throws TypeError

## Key Decisions

### 1. Fix Scope
**Decision:** Implement all three fixes for robustness.

Changes needed:
1. **sync.ts**: Add defensive null check (immediate fix)
2. **config.ts**: Implement deep merge instead of shallow merge (proper fix)
3. **install.ts**: Use `getDefaultConfig()` + `saveConfig()` like init.ts (DRY principle)

### 2. Deep Merge Strategy
**Decision:** Use a simple recursive deep merge function.

Rather than adding a dependency (lodash.merge, deepmerge), implement a lightweight merge utility that handles the PanopticonConfig structure.

The merge should:
- Recursively merge nested objects
- Allow user config to override specific values
- Preserve default values for missing user config properties
- Handle arrays by replacing (not concatenating) - user's array wins if present

### 3. Config Unification
**Decision:** Both `init.ts` and `install.ts` should use `getDefaultConfig()` + `saveConfig()`.

Benefits:
- Single source of truth for default config
- Eliminates template drift between commands
- Changes to defaults automatically propagate

**Implementation:**
- Remove hardcoded TOML template from install.ts
- Call `getDefaultConfig()` to get defaults
- Apply any install-specific overrides (e.g., Traefik enabled/disabled)
- Call `saveConfig()` to write

### 4. Null Check Approach
**Decision:** Fail gracefully with helpful message.

In sync.ts, if `targets` is undefined or not an array:
```typescript
const targets = config.sync?.targets;
if (!targets || !Array.isArray(targets) || targets.length === 0) {
  console.log(chalk.yellow('No sync targets configured.'));
  // ... helpful message about fixing config
  return;
}
```

## Scope

### In Scope

| File | Change |
|------|--------|
| `src/lib/config.ts` | Add `deepMerge()` utility, update `loadConfig()` |
| `src/cli/commands/sync.ts` | Add defensive null check for `targets` |
| `src/cli/commands/install.ts` | Refactor to use `getDefaultConfig()` + `saveConfig()` |

### Out of Scope

- Schema validation for config.toml
- Migration tool for existing malformed configs
- Config file versioning

## Architecture

### Deep Merge Utility

```typescript
function deepMerge<T extends object>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults };

  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const defaultVal = defaults[key];
    const overrideVal = overrides[key];

    if (overrideVal === undefined) continue;

    if (
      typeof defaultVal === 'object' &&
      defaultVal !== null &&
      !Array.isArray(defaultVal) &&
      typeof overrideVal === 'object' &&
      overrideVal !== null &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(defaultVal, overrideVal as any);
    } else {
      result[key] = overrideVal as T[keyof T];
    }
  }

  return result;
}
```

### Updated loadConfig()

```typescript
export function loadConfig(): PanopticonConfig {
  if (!existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = parse(content) as unknown as Partial<PanopticonConfig>;
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch (error) {
    console.error('Warning: Failed to parse config, using defaults');
    return DEFAULT_CONFIG;
  }
}
```

## Implementation Order

1. **Task 1**: Add defensive null check in sync.ts (quick win, fixes immediate crash)
2. **Task 2**: Implement deep merge in config.ts (proper fix)
3. **Task 3**: Refactor install.ts to use shared config functions (DRY)
4. **Task 4**: Manual testing of all paths

## Testing Plan

### Manual Test Cases

1. **Fresh install**: `rm -rf ~/.panopticon && pan install && pan sync` - should work
2. **Partial config**: Create config with `[sync]` section but no `targets` - should not crash
3. **init vs install**: Both commands should produce identical configs
4. **Deep merge**: User overrides single value in nested object - other defaults preserved

## Open Questions

None - scope is clear.

## References

- GitHub Issue: https://github.com/eltmon/panopticon-cli/issues/18
- Files:
  - `src/lib/config.ts:81-94` - loadConfig() with shallow merge
  - `src/cli/commands/sync.ts:16-22` - crashes on undefined targets
  - `src/cli/commands/install.ts:326-347` - incomplete config template
