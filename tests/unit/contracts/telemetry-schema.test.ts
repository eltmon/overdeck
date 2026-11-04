import { describe, expect, it } from 'vitest';
import { ROUTE_KINDS } from '../../../packages/contracts/src/machines.js';
import {
  TELEMETRY_EVENT_NAMES,
  TELEMETRY_PROPERTY_DOMAINS,
  bucketRelayBytes,
  type TelemetryEventName,
  type TelemetryEventProperties,
} from '../../../packages/contracts/src/telemetry.js';

type Values<T> = T extends unknown ? T[keyof T] : never;
type EventPropertyValues = Values<TelemetryEventProperties[keyof TelemetryEventProperties]>;
type MissingEventProperties = Exclude<TelemetryEventName, keyof TelemetryEventProperties>;
type ExtraEventProperties = Exclude<keyof TelemetryEventProperties, TelemetryEventName>;
type PropertyMapIsExact = [MissingEventProperties, ExtraEventProperties] extends [never, never] ? true : false;
type PropertyValuesAreRestricted =
  string extends Extract<EventPropertyValues, string> ? false
    : number extends Extract<EventPropertyValues, number> ? false
      : true;

const PROPERTY_MAP_IS_EXACT: PropertyMapIsExact = true;
const PROPERTY_VALUES_ARE_RESTRICTED: PropertyValuesAreRestricted = true;

const EXPECTED_EVENTS = [
  'dashboard_tab_viewed',
  'agent_spawned',
  'project_created',
  'issue_merged',
  'force_merge_triggered',
  'issue_closed_out',
  'bulk_close_out_initiated',
  'auto_merge_toggled',
  'conversation_forked',
  'plan_approved',
  'plan_changes_requested',
  'agent_question_answered',
  'server_boot',
  'cli_command_run',
  'pipeline_stage_changed',
  'github_quota_sample',
  'github_rate_limited',
  'instance_heartbeat',
  'machine_link_started',
  'machine_link_approved',
  'machine_link_failed',
  'phone_paired',
  'phone_removed',
  'anywhere_channel_opened',
  'relay_usage_sampled',
] as const satisfies readonly TelemetryEventName[];

describe('telemetry event schema', () => {
  it('exports all twenty-five telemetry event names', () => {
    expect(TELEMETRY_EVENT_NAMES).toEqual(EXPECTED_EVENTS);
  });

  it('maps every event to properties without broad string or number values', () => {
    expect(PROPERTY_MAP_IS_EXACT).toBe(true);
    expect(PROPERTY_VALUES_ARE_RESTRICTED).toBe(true);
  });

  it('buckets relayed bytes in decimal megabytes', () => {
    expect(bucketRelayBytes(0)).toBe('under_1mb');
    expect(bucketRelayBytes(999_999)).toBe('under_1mb');
    expect(bucketRelayBytes(1_000_000)).toBe('1mb-9mb');
    expect(bucketRelayBytes(9_999_999)).toBe('1mb-9mb');
    expect(bucketRelayBytes(10_000_000)).toBe('10mb-99mb');
    expect(bucketRelayBytes(999_999_999)).toBe('100mb-999mb');
    expect(bucketRelayBytes(1_000_000_000)).toBe('1gb+');
  });

  it('lists every route kind, plus the stored probe phase, as a channel route', () => {
    const channelRoutes: readonly string[] = TELEMETRY_PROPERTY_DOMAINS.channel_route;
    for (const kind of ROUTE_KINDS) expect(channelRoutes).toContain(kind);
    expect(channelRoutes).toContain('stored');
  });
});
