# PAN-45: Traefik fails to start due to Docker network label mismatch

## Status: PLANNING COMPLETE

## Problem

`pan up` fails to start Traefik with error:
```
network panopticon was found but has incorrect label com.docker.compose.network set to "" (expected: "panopticon")
```

**Root Cause:** `pan install` creates the Docker network directly via `docker network create`, but Traefik's `docker-compose.yml` expects to manage the network itself. Since the network wasn't created by docker-compose, it lacks the required labels.

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fix approach | Add `external: true` to network definition | Standard docker-compose pattern for pre-existing networks |
| Testing | Add regression test to e2e-traefik.sh | Prevent future regression |
| Upgrade path | Migration in `pan install` + auto-fix in `pan up` | Belt and suspenders - catch it in both places |

## Solution

### 1. Fix the Template (Primary Fix)

Update `templates/traefik/docker-compose.yml`:
```yaml
networks:
  panopticon:
    name: panopticon
    external: true  # Network created by 'pan install'
```

### 2. Migration in `pan install`

In `src/cli/commands/install.ts`, after the Traefik setup section, check if existing `~/.panopticon/traefik/docker-compose.yml` needs patching:

```typescript
// Check if existing docker-compose.yml needs migration (for upgrades)
const existingCompose = join(TRAEFIK_DIR, 'docker-compose.yml');
if (existsSync(existingCompose)) {
  const content = readFileSync(existingCompose, 'utf-8');
  if (content.includes('panopticon:') && !content.includes('external: true')) {
    // Patch the file to add external: true
    const patched = content.replace(
      /networks:\s*\n\s*panopticon:\s*\n\s*name: panopticon\s*\n\s*driver: bridge/,
      'networks:\n  panopticon:\n    name: panopticon\n    external: true'
    );
    writeFileSync(existingCompose, patched);
    spinner.info('Migrated Traefik config (added external: true to network)');
  }
}
```

### 3. Auto-fix in `pan up`

In `src/cli/index.ts`, before running `docker-compose up -d` in the Traefik section:

```typescript
// Ensure network is marked as external (migration for older installs)
const composeFile = join(traefikDir, 'docker-compose.yml');
if (existsSync(composeFile)) {
  const content = readFileSync(composeFile, 'utf-8');
  if (!content.includes('external: true') && content.includes('panopticon:')) {
    const patched = content.replace(
      /networks:\s*\n\s*panopticon:\s*\n\s*name: panopticon\s*\n(\s*driver: bridge)?/,
      'networks:\n  panopticon:\n    name: panopticon\n    external: true'
    );
    writeFileSync(composeFile, patched);
    console.log(chalk.dim('  (migrated network config)'));
  }
}
```

### 4. Regression Test

Add to `tests/e2e-traefik.sh`:

```bash
test_install_then_up() {
  echo "=== Test: pan install then pan up (network label mismatch regression) ==="

  # Clean state
  docker network rm panopticon 2>/dev/null || true
  rm -rf ~/.panopticon/traefik

  # Run install (creates network)
  pan install --skip-mkcert

  # Verify network exists
  if ! docker network ls | grep -q panopticon; then
    echo "FAIL: Network not created by pan install"
    return 1
  fi

  # Verify docker-compose can use the network (the actual bug)
  cd ~/.panopticon/traefik
  if ! docker-compose config > /dev/null 2>&1; then
    echo "FAIL: docker-compose config failed - network label mismatch?"
    return 1
  fi

  echo "PASS: install then up works correctly"
}
```

## Files to Modify

| File | Change |
|------|--------|
| `templates/traefik/docker-compose.yml` | Add `external: true` to network |
| `src/cli/commands/install.ts` | Add migration for existing installs |
| `src/cli/index.ts` | Add auto-fix before `docker-compose up` |
| `tests/e2e-traefik.sh` | Add regression test |

## Out of Scope

- Changing how `pan install` creates the network (keep using `docker network create`)
- Modifying other docker-compose templates (they already use `external: true`)
- Dashboard docker-compose.yml (already correct)

## Acceptance Criteria

1. Fresh install: `pan install && pan up` starts Traefik without errors
2. Existing install: `pan up` auto-fixes and starts Traefik
3. Test: e2e-traefik.sh passes with new test case
4. Consistency: Traefik docker-compose.yml matches dashboard pattern

## Beads Tasks

| ID | Title | Status | Blocked By |
|----|-------|--------|------------|
| panopticon-6a6o | Fix templates/traefik/docker-compose.yml | open | - |
| panopticon-z5oc | Add migration to pan install | open | - |
| panopticon-hm01 | Add auto-fix to pan up | open | - |
| panopticon-mlc0 | Add regression test to e2e-traefik.sh | open | - |

## References

- GitHub Issue: https://github.com/eltmon/panopticon-cli/issues/45
- Docker Compose external networks: https://docs.docker.com/compose/networking/#use-a-pre-existing-network
