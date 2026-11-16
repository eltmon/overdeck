//#region semgrep-edit-hook.d.ts
interface SemgrepEditHookDeps {
  execFile?: (file: string, args: string[], opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
  }) => Promise<{
    stdout: string;
  }>;
  readFile?: (path: string) => Promise<string>;
  stat?: (path: string) => Promise<{
    isFile(): boolean;
    size: number;
  }>;
  exists?: (path: string) => Promise<boolean>;
  lstat?: (path: string) => Promise<{
    isSymbolicLink(): boolean;
  }>;
  readlink?: (path: string) => Promise<string>;
}
/** The env the scan child gets: `base` minus SEMGREP_APP_TOKEN/SEMGREP_RULES, plus quiet + Overdeck-owned state paths. */
declare function semgrepScanEnv(base: Record<string, string | undefined>, home: string): Record<string, string>;
/** Returns the hook's stdout ('' for no output). Never throws. */
declare function runSemgrepEditHook(input: string, env: Record<string, string | undefined>, deps?: SemgrepEditHookDeps): Promise<string>;
//#endregion
export { SemgrepEditHookDeps, runSemgrepEditHook, semgrepScanEnv };
//# sourceMappingURL=semgrep-edit-hook.d.ts.map