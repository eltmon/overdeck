import type { RoleEffort } from '../../lib/config-yaml.js';
import type { RuntimeName } from '../../lib/runtimes/types.js';
import type { PlanningMode } from './planning-mode.js';

export interface IssueOptions {
  model: string;
  /** PAN-636 — explicit coding-agent harness override. Omit to use resolver defaults. */
  harness?: RuntimeName;
  /** Claude Code `--effort` level. Overrides roles.work.effort for this spawn. */
  effort?: RoleEffort;
  dryRun?: boolean;
  shadow?: boolean;
  remote?: boolean;
  local?: boolean;
  /** Remote workspace resiliency tier override: ephemeral | durable. */
  tier?: string;
  /** Explicit planning-depth flag: interactive | auto | skip. */
  plan?: string;
  /** Legacy auto-skip-planning flag; deprecated — use --plan skip instead. */
  auto?: boolean;
  host?: boolean;
  yes?: boolean;
  offBook?: boolean;
  force?: boolean;
  /** Drop the saved Claude session pointer (non-destructive) and start a brand-new
   *  session — the one-step "restart fresh" path, e.g. to switch a stopped agent's model. */
  fresh?: boolean;
  /** Resolved planning mode for this start invocation. Set by issueCommand. */
  planningMode?: PlanningMode;
}
