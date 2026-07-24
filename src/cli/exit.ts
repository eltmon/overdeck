type CliExitFinalizer = (code: number) => Promise<void>;

let finalizeCliExit: CliExitFinalizer = async () => undefined;

export function registerCliExitFinalizer(finalizer: CliExitFinalizer): void {
  finalizeCliExit = finalizer;
}

export async function exitCli(
  code: number,
  exit: (code: number) => never = (exitCode) => process.exit(exitCode),
): Promise<never> {
  await finalizeCliExit(code);
  return exit(code);
}
