export type ResumeCause = 'operator' | 'system' | 'message';

export function buildResumeContract(cause: ResumeCause): string {
  const reason = cause === 'operator'
    ? 'The operator resumed this session after stopping or pausing it.'
    : cause === 'message'
      ? 'This session was resumed because a new message arrived while it was stopped.'
      : 'This session was restored after its prior process ended unexpectedly, such as during a crash or reboot.';

  return `${reason} The conversation transcript was restored, but process-local machinery was not. ` +
    'Re-establish any timers or wakeups, monitors, background processes, loops, or cron work you still need before continuing. ' +
    'If this session runs a recurring tick loop, explicitly arm its next wakeup now.';
}
