export function buildLocalMainRecoveryError(
  projectPath: string,
  aheadCount: number,
  behindCount: number,
): string {
  if (aheadCount > 0 && behindCount > 0) {
    return `Local main has diverged from origin/main: ${aheadCount} local commit(s) and ${behindCount} remote commit(s) are unique. `
      + `A previous approve attempt left unpushed work while origin/main also advanced. To recover, preserve it:\n`
      + `  cd ${projectPath} && git fetch origin main && git merge origin/main\n`
      + 'Resolve any conflicts, then push main. If the local commits should not land, revert them explicitly instead of resetting. '
      + 'Then unstick the workspace and retry.';
  }
  return `Local main is ${aheadCount} commit(s) ahead of origin/main — a previous approve attempt left unpushed work. `
    + `To recover, preserve it:\n  cd ${projectPath} && git push origin main\n`
    + 'If those commits should not land, revert them explicitly instead of resetting. Then unstick the workspace and retry.';
}
