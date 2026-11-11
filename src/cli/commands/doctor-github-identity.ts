/**
 * `pan doctor`: one row per GitHub owner naming who acts there (PAN-5153).
 *
 * The identities come from `collectGitHubIdentities({ fresh: true })`, so the
 * App installation lookup is asked again. For a repository Overdeck acts on
 * as the gh user, the row checks that the user can push, that SAML does not
 * block the token, and that the project checkout no longer pushes with a bot
 * credential file left over from the App path.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { collectGitHubIdentities, type GitHubIdentitiesSnapshot } from '../../lib/github-repo-identity.js';
import { runGh } from '../../lib/github-quota/run-gh.js';
import { getOverdeckHome } from '../../lib/paths.js';
import { getProjectSync } from '../../lib/projects.js';

const execFileAsync = promisify(execFile);

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-first-run.ts and doctor-semgrep.ts) so this module does not import
// doctor.ts and form a cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface GitHubIdentityCheckDeps {
  collect?: () => Promise<GitHubIdentitiesSnapshot>;
  /** `.permissions.push` of the repository for the gh user ('true' or 'false'). Throws on failure. */
  canPush?: (repo: string) => Promise<string>;
  /** `git config --get credential.helper` in the project checkout, or null. */
  credentialHelper?: (projectPath: string) => Promise<string | null>;
  projectPath?: (projectKey: string) => string | null;
}

type ProblemKind = 'saml' | 'access' | 'login' | 'credfile';
interface Problem { kind: ProblemKind; message: string; path?: string }

async function defaultCanPush(repo: string): Promise<string> {
  const { stdout } = await runGh(['api', `repos/${repo}`, '--jq', '.permissions.push'], { timeout: 15_000 });
  return stdout;
}

async function defaultCredentialHelper(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'credential.helper'], {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === 'string' ? `${error.message}\n${stderr}` : error.message;
}

function fixFor(owner: string, problem: Problem): string {
  switch (problem.kind) {
    case 'saml':
      return 'Run: gh auth refresh -h github.com, and authorize the organization in the browser';
    case 'access':
      return `Ask an owner of ${owner} for write access, or install the GitHub App on ${owner}`;
    case 'login':
      return 'Run: gh auth login';
    case 'credfile':
      return `In ${problem.path} run: git config --unset credential.helper, then set origin back to your own remote URL`;
  }
}

/** One `GitHub identity: <owner>` row per owner; no rows when no project names a GitHub repository. */
export async function checkGitHubIdentities(deps: GitHubIdentityCheckDeps = {}): Promise<CheckResult[]> {
  const snapshot = await (deps.collect ?? (() => collectGitHubIdentities({ fresh: true })))();
  const canPush = deps.canPush ?? defaultCanPush;
  const credentialHelper = deps.credentialHelper ?? defaultCredentialHelper;
  const projectPath = deps.projectPath ?? ((key: string) => getProjectSync(key)?.path ?? null);
  const botCredentialDir = `${join(getOverdeckHome(), 'credentials')}/`;

  const rows: CheckResult[] = [];
  for (const { owner, projects } of snapshot.owners) {
    const problems: Problem[] = [];
    const actorCounts = new Map<string, number>();
    for (const project of projects) {
      const actor = project.actor ?? 'nobody';
      actorCounts.set(actor, (actorCounts.get(actor) ?? 0) + 1);

      if (project.mode === 'user') {
        try {
          const push = (await canPush(project.repo)).trim();
          if (push !== 'true') problems.push({ kind: 'access', message: `${project.actor} has no push access to ${project.repo}` });
        } catch (error) {
          problems.push(/SAML/.test(errorText(error))
            ? { kind: 'saml', message: `${project.repo} needs SAML authorization for the gh token` }
            : { kind: 'access', message: `${project.actor} cannot read ${project.repo}` });
        }
      } else if (project.mode === 'none') {
        problems.push({ kind: 'login', message: project.detail });
      }

      if (project.mode !== 'app') {
        const path = projectPath(project.key);
        const helper = path ? await credentialHelper(path).catch(() => null) : null;
        if (path && helper?.includes(botCredentialDir)) {
          problems.push({ kind: 'credfile', message: `${project.repo} still pushes with a bot credential file`, path });
        }
      }
    }

    const name = `GitHub identity: ${owner}`;
    if (problems.length === 0) {
      const message = [...actorCounts]
        .map(([actor, count]) => `${actor} (${count} ${count === 1 ? 'repo' : 'repos'})`)
        .join(', ');
      rows.push({ name, status: 'ok', message });
    } else {
      rows.push({
        name,
        status: 'warn',
        message: problems.map((p) => p.message).join('; '),
        fix: fixFor(owner, problems[0]!),
      });
    }
  }
  return rows;
}

/** The doctor entry point: the identity rows, or one warn row when the check itself fails. */
export async function checkGitHubIdentityRows(deps: GitHubIdentityCheckDeps = {}): Promise<CheckResult[]> {
  try {
    return await checkGitHubIdentities(deps);
  } catch (error) {
    return [{ name: 'GitHub identity', status: 'warn', message: error instanceof Error ? error.message : String(error) }];
  }
}
