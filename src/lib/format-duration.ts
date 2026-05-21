/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * Examples:
 *   formatDuration(500) => "< 1s"
 *   formatDuration(5000) => "5s"
 *   formatDuration(65000) => "1m 5s"
 *   formatDuration(3665000) => "1h 1m 5s"
 *
 * All exports are Effect-native (PAN-1249 wave-0 migration).
 */

import { Effect } from 'effect';

export function formatDuration(ms: number): Effect.Effect<string, never> {
  return Effect.sync(() => {
    if (ms < 0) return "0s";
    if (ms < 1000) return "< 1s";

    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 60000) % 60;
    const hours = Math.floor(ms / 3600000);

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(" ");
  });
}

/**
 * Format a timestamp to relative time (e.g., "5 minutes ago").
 */
export function timeAgo(timestamp: string | Date): Effect.Effect<string, never> {
  return Effect.sync(() => {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diff = now - then;

    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  });
}
