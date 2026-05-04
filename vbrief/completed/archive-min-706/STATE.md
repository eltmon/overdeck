# MIN-706: Build OpenClaw Plugin for MYN — @mindyournow/openclaw-plugin

**Status:** ✅ IMPLEMENTATION COMPLETE
**Created:** 2026-03-01
**Completed:** 2026-03-01
**Issue:** [MIN-706](https://linear.app/mind-your-now/issue/MIN-706/build-openclaw-plugin-for-myn-mindyournowopenclaw-plugin)

## Summary

The OpenClaw plugin has been fully implemented and committed to `/home/eltmon/Projects/myn/openclaw-plugin/`. All 12 tools are working with comprehensive test coverage (87 tests passing).

---

## Decisions Made

### 1. Code Location
**Decision:** `/home/eltmon/Projects/myn/openclaw-plugin/` — new subdirectory with its own git repo.

**Rationale:** Standalone npm package (`@mindyournow/openclaw-plugin`) that lives alongside but separate from the MYN monorepo. Gets its own `git init`, `package.json`, and independent version.

### 2. Tool Scope — 12 Tools
**Decision:** The issue's 11 tools + `myn_lists` (grocery/shopping) = 12 total.

| Tool | Actions | Primary Endpoints |
|------|---------|-------------------|
| `myn_tasks` | list, get, create, update, complete, archive, search | `/api/v2/unified-tasks/**` |
| `myn_briefing` | status, generate, get, apply_correction, complete_session | `/api/v2/compass/**` |
| `myn_calendar` | list_events, create_event, delete_event, meetings | `/api/calendar/**`, `/api/v2/calendar/**` |
| `myn_habits` | streaks, skip, chains, schedule, reminders | `/api/v1/habit-chains/**`, `/api/habits/reminders/**` |
| `myn_lists` | get, add, toggle, bulk_add, convert_to_tasks | `/api/v1/households/{id}/grocery-list/**` |
| `myn_search` | search | `/api/v2/search` |
| `myn_timers` | create_countdown, create_alarm, list, cancel, snooze, pomodoro | `/api/v2/timers/**` |
| `myn_memory` | remember, recall, forget, search | `/api/v1/customers/memories/**` |
| `myn_profile` | get_info, get_goals, update_goals, preferences | `/api/v1/customers/**` |
| `myn_household` | members, invite, chores, chore_schedule, chore_complete | `/api/v1/households/**`, `/api/v2/chores/**` |
| `myn_projects` | list, get, create, move_task | `/api/project/**` |
| `myn_planning` | plan, schedule_all, reschedule | `/api/schedules/**` |

### 3. Architecture
**Decision:** Action-multiplexed pattern — each tool has an `action` parameter that dispatches to different API operations.

- **Plugin entry:** Object export with `register(api: OpenClawPluginApi)` method
- **API Client:** Shared `MynApiClient` class wrapping `fetch` with `X-API-KEY` auth header
- **Tool schemas:** `@sinclair/typebox` with `optionalStringEnum` for actions
- **Tool results:** `jsonResult()` helper for consistent response formatting
- **Error handling:** HTTP errors mapped to tool error responses with status code + message

### 4. Authentication
**Decision:** `X-API-KEY` header with `AGENT_FULL` scope stored in plugin config.

- Key stored in `plugins.entries.myn.config.apiKey`
- Client reads from `api.pluginConfig?.apiKey`
- Default base URL: `https://api.mindyournow.com` (overridable)
- If `apiKey` not configured, skip all tool registration with a warning log

### 5. Testing Strategy
**Decision:** Vitest + mock fetch. No production endpoint testing.

- Unit tests: Mock `globalThis.fetch` with `vi.fn()` for each tool's execute function
- Integration tests: Test tool registration, parameter validation, error handling
- Coverage: Every action of every tool tested
- No MSW or external dependencies for mocking

### 6. Companion SKILL.md
**Decision:** Include in MIN-706 scope.

- Ships with the plugin at `skills/myn/SKILL.md`
- Referenced in manifest via `"skills": ["skills/myn"]`
- Teaches agent MYN workflow patterns: morning routine, task priorities, creation rules

### 7. Distribution
**Decision:** npm package `@mindyournow/openclaw-plugin`.

- Installed via `openclaw plugins install @mindyournow/openclaw-plugin`
- Enabled via config: `plugins.entries.myn.enabled: true`
- TypeScript source loaded at runtime via jiti (no build step needed for OpenClaw)
- For npm distribution, include compiled JS as well

---

## Project Structure

```
openclaw-plugin/
  openclaw.plugin.json          # Manifest: id, config schema, UI hints
  package.json                  # @mindyournow/openclaw-plugin
  tsconfig.json                 # TypeScript config
  vitest.config.ts              # Test config
  index.ts                      # Entry point, registers all tools
  src/
    client.ts                   # MYN API client (fetch wrapper with auth)
    tools/
      tasks.ts                  # myn_tasks — Task CRUD, lifecycle
      briefing.ts               # myn_briefing — Compass briefing
      calendar.ts               # myn_calendar — Calendar events
      habits.ts                 # myn_habits — Habit tracking, streaks
      lists.ts                  # myn_lists — Grocery/shopping lists
      search.ts                 # myn_search — Unified search
      timers.ts                 # myn_timers — Countdown, alarm, pomodoro
      memory.ts                 # myn_memory — Agent memory
      profile.ts                # myn_profile — User info, goals, prefs
      household.ts              # myn_household — Members, chores
      projects.ts               # myn_projects — Project management
      planning.ts               # myn_planning — AI planning, scheduling
  skills/
    myn/SKILL.md                # Companion skill for workflow patterns
  tests/
    client.test.ts              # API client unit tests
    tools/
      tasks.test.ts             # per-tool test files
      briefing.test.ts
      calendar.test.ts
      habits.test.ts
      lists.test.ts
      search.test.ts
      timers.test.ts
      memory.test.ts
      profile.test.ts
      household.test.ts
      projects.test.ts
      planning.test.ts
    integration/
      registration.test.ts     # Plugin registration & config tests
  README.md                     # Setup, tool reference, examples
```

---

## Key Implementation Details

### MYN API Client (`src/client.ts`)
- `MynApiClient` class with `baseUrl` and `apiKey` constructor params
- Methods: `get<T>(path)`, `post<T>(path, body?)`, `put<T>(path, body?)`, `delete<T>(path)`, `patch<T>(path, body?)`
- Auth: `X-API-KEY: {apiKey}` header on all requests
- Content-Type: `application/json`
- Error handling: Throw descriptive error with HTTP status + response body text
- Handle 204 No Content responses

### Plugin Entry Point (`index.ts`)
```ts
export default {
  id: "myn",
  name: "Mind Your Now",
  configSchema: { /* from manifest */ },
  register(api: OpenClawPluginApi) {
    const apiKey = api.pluginConfig?.apiKey as string | undefined;
    const baseUrl = (api.pluginConfig?.baseUrl as string) || "https://api.mindyournow.com";
    if (!apiKey) {
      api.logger.warn("[myn] apiKey not configured; tools will not be registered");
      return;
    }
    const client = new MynApiClient(baseUrl, apiKey);
    // Register all 12 tools
    registerTasksTool(api, client);
    registerBriefingTool(api, client);
    // ... etc
  }
};
```

### Task Creation Rules (critical for SKILL.md)
- Client MUST provide UUID in `id` field (`crypto.randomUUID()`)
- Priority required: `CRITICAL`, `OPPORTUNITY_NOW`, `OVER_THE_HORIZON`, `PARKING_LOT`
- `startDate` required (ISO-8601)
- Duration format: "30m", "1h", "1h30m" (NOT ISO PT prefix)
- HABIT type: MUST have `recurrenceRule`, CANNOT be shared
- CHORE type: MUST have `recurrenceRule`, always household-scoped

---

## Out of Scope
- Track B: Managed provisioning / per-user OpenClaw instances
- AgentMail email integration
- Lifecycle hooks (before_agent_start, etc.) — can be added later
- Optional/admin tools
- myn_notifications, myn_gamification (low agent value)

---

## Dependencies
- MIN-705 (Done) — API key auth overhaul
- MIN-708 (Done) — HabitReminderController fix
- OpenClaw plugin SDK (`openclaw` as devDependency)
- `@sinclair/typebox` for tool schemas

---

## Implementation Summary

### ✅ Completed Tasks

| Task | Status | File |
|------|--------|------|
| Package setup (package.json, tsconfig, vitest) | ✅ Done | `package.json`, `tsconfig.json`, `vitest.config.ts` |
| OpenClaw manifest | ✅ Done | `openclaw.plugin.json` |
| MYN API Client | ✅ Done | `src/client.ts` |
| myn_tasks tool | ✅ Done | `src/tools/tasks.ts` |
| myn_briefing tool | ✅ Done | `src/tools/briefing.ts` |
| myn_calendar tool | ✅ Done | `src/tools/calendar.ts` |
| myn_habits tool | ✅ Done | `src/tools/habits.ts` |
| myn_lists tool | ✅ Done | `src/tools/lists.ts` |
| myn_search tool | ✅ Done | `src/tools/search.ts` |
| myn_timers tool | ✅ Done | `src/tools/timers.ts` |
| myn_memory tool | ✅ Done | `src/tools/memory.ts` |
| myn_profile tool | ✅ Done | `src/tools/profile.ts` |
| myn_household tool | ✅ Done | `src/tools/household.ts` |
| myn_projects tool | ✅ Done | `src/tools/projects.ts` |
| myn_planning tool | ✅ Done | `src/tools/planning.ts` |
| Plugin entry point | ✅ Done | `index.ts` |
| Companion SKILL.md | ✅ Done | `skills/myn/SKILL.md` |
| README.md | ✅ Done | `README.md` |
| Unit tests (87 tests) | ✅ Done | `tests/` |

### Test Results
```
✓ 8 test files passed
✓ 87 tests passed
✓ TypeScript build successful
```

### Git Commit
Commit: `26991fd` - feat: Initial implementation of @mindyournow/openclaw-plugin

## Risk & Unknowns
- **Grocery list endpoints**: Need to verify exact paths under `/api/v1/households/{id}/grocery-list/**`. If they don't exist, the `myn_lists` tool will need to adapt.
- **npm org**: Need `@mindyournow` npm organization to be created/claimed before publishing.
- **OpenClaw version compatibility**: Plugin targets `openclaw@2026.2.22+`. Need to verify plugin SDK API stability.
