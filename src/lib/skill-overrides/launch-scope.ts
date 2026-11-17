/**
 * PAN-5465: the launch context and its scope resolution, split out of
 * launch.ts as a leaf so sageox/launch.ts can import them while launch.ts
 * imports sageox/launch.ts (launchPackExclude) without an import cycle.
 */

export interface LaunchSkillContext {
  cwd: string;
  issueId?: string;
  /** Conversation tmux session whose row carries a per-conversation skill map (PAN-4486). */
  conversation?: string;
  /** PAN-5465: use this map as the conversation layer instead of reading the row (hot apply checks a map before storing it). */
  conversationLayer?: Record<string, boolean>;
}

/** Issue from ctx or the workspace path, project from the cwd. */
export async function resolveLaunchScope(ctx: LaunchSkillContext): Promise<{ projectKey?: string; issueId?: string }> {
  const [{ resolveProjectKeyForCwdAsync }, { issueIdFromWorkspacePath }] = await Promise.all([
    import('../projects.js'),
    import('../xbrief/io.js'),
  ]);
  const issueId = ctx.issueId ?? issueIdFromWorkspacePath(ctx.cwd) ?? undefined;
  const projectKey = (await resolveProjectKeyForCwdAsync(ctx.cwd)) ?? undefined;
  return { projectKey, issueId };
}
