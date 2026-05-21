import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { formatDuration, timeAgo } from "../../src/lib/format-duration.js";

describe("formatDuration", () => {
  it("should return '< 1s' for sub-second durations", () => {
    expect(Effect.runSync(formatDuration(0))).toBe("< 1s");
    expect(Effect.runSync(formatDuration(500))).toBe("< 1s");
    expect(Effect.runSync(formatDuration(999))).toBe("< 1s");
  });

  it("should return '0s' for negative values", () => {
    expect(Effect.runSync(formatDuration(-100))).toBe("0s");
    expect(Effect.runSync(formatDuration(-1))).toBe("0s");
  });

  it("should format seconds correctly", () => {
    expect(Effect.runSync(formatDuration(1000))).toBe("1s");
    expect(Effect.runSync(formatDuration(5000))).toBe("5s");
    expect(Effect.runSync(formatDuration(59000))).toBe("59s");
  });

  it("should format minutes and seconds", () => {
    expect(Effect.runSync(formatDuration(60000))).toBe("1m");
    expect(Effect.runSync(formatDuration(65000))).toBe("1m 5s");
    expect(Effect.runSync(formatDuration(120000))).toBe("2m");
    expect(Effect.runSync(formatDuration(3599000))).toBe("59m 59s");
  });

  it("should format hours, minutes, and seconds", () => {
    expect(Effect.runSync(formatDuration(3600000))).toBe("1h");
    expect(Effect.runSync(formatDuration(3665000))).toBe("1h 1m 5s");
    expect(Effect.runSync(formatDuration(7200000))).toBe("2h");
    expect(Effect.runSync(formatDuration(86400000))).toBe("24h");
  });
});

describe("timeAgo", () => {
  it("should return 'just now' for recent timestamps", () => {
    const now = new Date();
    expect(Effect.runSync(timeAgo(now))).toBe("just now");
  });

  it("should return minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000);
    expect(Effect.runSync(timeAgo(fiveMinAgo))).toBe("5m ago");
  });

  it("should return hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
    expect(Effect.runSync(timeAgo(twoHoursAgo))).toBe("2h ago");
  });

  it("should return days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
    expect(Effect.runSync(timeAgo(threeDaysAgo))).toBe("3d ago");
  });

  it("should accept string timestamps", () => {
    const recent = new Date(Date.now() - 30000).toISOString();
    expect(Effect.runSync(timeAgo(recent))).toBe("just now");
  });
});
