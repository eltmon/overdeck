/**
 * Linux file-manager entries for "Open in Overdeck" (PAN-5349 O-D13). Every
 * entry runs the absolute `pan` path, so it works without a login shell's PATH.
 */

/**
 * One quoted argument of a desktop-entry `Exec` key. The spec unescapes the
 * string value before it applies the quoting rule, so a quoted `"`, `` ` ``,
 * `$` or `\` needs two backslashes in the file, and a backslash four.
 */
export function desktopExecArg(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\\\\\').replace(/(["`$])/g, '\\\\$1');
  return `"${escaped}"`;
}

/** One double-quoted `sh` argument. */
export function shellDoubleQuote(value: string): string {
  return `"${value.replace(/(["`$\\])/g, '\\$1')}"`;
}

/** `~/.local/share/applications/overdeck-open.desktop`: "Open With → Overdeck". */
export function renderOpenWithDesktopEntry(panPath: string, iconPath?: string | null): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Overdeck',
    'Comment=Open in Overdeck',
    `Exec=${desktopExecArg(panPath)} open %f`,
    'NoDisplay=true',
    'Terminal=false',
    'MimeType=inode/directory;text/plain;application/octet-stream;',
    ...(iconPath ? [`Icon=${iconPath}`] : []),
    '',
  ].join('\n');
}

/** GNOME Files: `~/.local/share/nautilus/scripts/Open in Overdeck` (right-click → Scripts). */
export function renderNautilusScript(panPath: string): string {
  return `#!/bin/sh\nfor f in "$@"; do ${shellDoubleQuote(panPath)} open "$f"; done\n`;
}

/** KDE Dolphin: `~/.local/share/kio/servicemenus/overdeck-open.desktop`. */
export function renderDolphinServiceMenu(panPath: string, iconPath?: string | null): string {
  return [
    '[Desktop Entry]',
    'Type=Service',
    'MimeType=all/all;',
    'Actions=openInOverdeck;',
    'X-KDE-Priority=TopLevel',
    '',
    '[Desktop Action openInOverdeck]',
    'Name=Open in Overdeck',
    ...(iconPath ? [`Icon=${iconPath}`] : []),
    `Exec=${desktopExecArg(panPath)} open %f`,
    '',
  ].join('\n');
}
