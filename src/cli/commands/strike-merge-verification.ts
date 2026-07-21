import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function verifyStrikeBranchMergedIntoMain(issueId: string, projectPath: string): Promise<string> {
  const branchName = `strike/${issueId.toLowerCase()}`;
  const quotedBranch = shellQuote(branchName);

  await execAsync('git fetch origin main', {
    cwd: projectPath,
    encoding: 'utf-8',
    timeout: 60000,
  });

  let branchHead: string | undefined;
  try {
    const { stdout } = await execAsync(`git rev-parse --verify ${quotedBranch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 10000,
    });
    branchHead = stdout.trim();
  } catch {
    // A merged PR may delete the branch. The forge record below remains authoritative.
  }

  if (branchHead) {
    try {
      await execAsync(`git merge-base --is-ancestor ${quotedBranch} origin/main`, {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 10000,
      });
      return `${branchName} is contained in origin/main`;
    } catch {
      // Squash merges create a new commit, so the original branch is not an ancestor.
    }
  }

  try {
    const { stdout } = await execAsync(
      `gh pr list --head ${quotedBranch} --state merged --json headRefOid,mergeCommit --limit 1`,
      { cwd: projectPath, encoding: 'utf-8', timeout: 15000 },
    );
    const prs = JSON.parse(stdout) as Array<{ headRefOid?: string; mergeCommit?: { oid?: string } }>;
    const pr = prs[0];
    if (pr?.mergeCommit?.oid && (!branchHead || pr.headRefOid === branchHead)) {
      await execAsync(`git merge-base --is-ancestor ${shellQuote(pr.mergeCommit.oid)} origin/main`, {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 10000,
      });
      return `${branchName} was merged by PR at ${pr.mergeCommit.oid}`;
    }
  } catch {
    // No matching merged PR or forge access; fall through to local patch equivalence.
  }

  if (branchHead) {
    const { stdout } = await execAsync(`git cherry origin/main ${quotedBranch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 10000,
    });
    const missingCommits = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('+'));
    if (missingCommits.length === 0) {
      return `${branchName} has no commits missing from origin/main`;
    }
    throw new Error(`${branchName} has ${missingCommits.length} commit(s) missing from origin/main`);
  }

  throw new Error(`${branchName} is unavailable locally and no merged PR was found on origin/main`);
}
