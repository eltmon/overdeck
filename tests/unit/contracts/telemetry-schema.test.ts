import { describe, expect, it } from 'vitest';
import {
  TELEMETRY_EVENT_NAMES,
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
] as const satisfies readonly TelemetryEventName[];

describe('telemetry event schema', () => {
  it('exports all fifteen telemetry event names', () => {
    expect(TELEMETRY_EVENT_NAMES).toEqual(EXPECTED_EVENTS);
  });

  it('maps every event to properties without broad string or number values', () => {
    expect(PROPERTY_MAP_IS_EXACT).toBe(true);
    expect(PROPERTY_VALUES_ARE_RESTRICTED).toBe(true);
  });
});
