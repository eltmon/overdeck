//#region gh-issue-trailer-hook.d.ts
type HookEnv = Record<string, string | undefined>;
declare function rewriteGhIssueCreateCommand(command: string, env?: HookEnv): string | null;
declare function runGhIssueTrailerHook(input: string, env?: HookEnv): string;
//#endregion
export { rewriteGhIssueCreateCommand, runGhIssueTrailerHook };
//# sourceMappingURL=gh-issue-trailer-hook.d.ts.map