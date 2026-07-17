import type { AdmissionState, HealthReason, HealthState } from '@overdeck/contracts';

import type { SystemHealthThresholds } from './config.js';
import { DARWIN_MEMORY_PRESSURE_DEFAULTS } from './darwin.js';
import { LINUX_MEMORY_PRESSURE_DEFAULTS } from './linux.js';
import type { HostMetricSample, HostMetricSignal } from './types.js';

export interface AdmissionAssessment {
  state: AdmissionState;
  availableMemoryBytes: number | null;
  reasons: HealthReason[];
}

export interface HostPressureAssessment {
  state: HealthState;
  reasons: HealthReason[];
  diagnostics: HealthReason[];
  admission: AdmissionAssessment;
}

function value(signal: HostMetricSignal<number>): number | null {
  return signal.status === 'available' ? signal.value : null;
}

function reason(
  code: string,
  domain: HealthReason['domain'],
  severity: HealthReason['severity'],
  message: string,
  metric: string,
  observed: number,
  threshold: number,
): HealthReason {
  return { code, domain, severity, message, metric, observed, threshold };
}

function evaluateAdmission(
  sample: HostMetricSample,
  thresholds: SystemHealthThresholds,
): AdmissionAssessment {
  const availableMemoryBytes = value(sample.availableMemoryBytes);
  if (availableMemoryBytes == null) {
    return {
      state: 'unavailable',
      availableMemoryBytes: null,
      reasons: [{
        code: 'admission.memory_available.unavailable',
        domain: 'admission',
        severity: 'info',
        message: 'Available memory could not be measured, so admission capacity is unavailable.',
        metric: 'availableMemoryBytes',
      }],
    };
  }

  if (availableMemoryBytes <= thresholds.memoryAvailableCriticalBytes) {
    return {
      state: 'blocked',
      availableMemoryBytes,
      reasons: [reason(
        'admission.memory_available.blocked',
        'admission',
        'critical',
        'Available memory is at or below the critical admission reserve.',
        'availableMemoryBytes',
        availableMemoryBytes,
        thresholds.memoryAvailableCriticalBytes,
      )],
    };
  }

  if (availableMemoryBytes <= thresholds.memoryAvailableWarningBytes) {
    return {
      state: 'soft',
      availableMemoryBytes,
      reasons: [reason(
        'admission.memory_available.soft',
        'admission',
        'warning',
        'Available memory is at or below the warning admission reserve.',
        'availableMemoryBytes',
        availableMemoryBytes,
        thresholds.memoryAvailableWarningBytes,
      )],
    };
  }

  return { state: 'open', availableMemoryBytes, reasons: [] };
}

function diagnostics(sample: HostMetricSample, thresholds: SystemHealthThresholds): HealthReason[] {
  const results: HealthReason[] = [];
  const swapUsedPercent = value(sample.swapUsedPercent);
  if (swapUsedPercent != null && swapUsedPercent > 0) {
    results.push(reason(
      'host.diagnostic.swap_occupancy',
      'host',
      'info',
      'Swap occupancy is historical context and does not represent current pressure.',
      'swapUsedPercent',
      swapUsedPercent,
      thresholds.swapUsedWarningPercent,
    ));
  }

  const virtualCommitmentPercent = value(sample.virtualCommitmentPercent);
  if (virtualCommitmentPercent != null) {
    results.push(reason(
      'host.diagnostic.virtual_commitment',
      'host',
      'info',
      'Virtual memory commitment is diagnostic and does not represent current pressure.',
      'virtualCommitmentPercent',
      virtualCommitmentPercent,
      thresholds.overcommitWarningPercent,
    ));
  }
  return results;
}

function linuxPressureReasons(
  sample: HostMetricSample,
  admission: AdmissionAssessment,
): HealthReason[] {
  const results: HealthReason[] = [];
  const some = value(sample.memoryPressureSomeAvg10);
  const full = value(sample.memoryPressureFullAvg10);
  const swapActivity = value(sample.swapActivityBytesPerMinute);

  if (admission.state === 'blocked') {
    if (full != null && full >= LINUX_MEMORY_PRESSURE_DEFAULTS.fullCriticalAvg10) {
      results.push(reason(
        'host.linux.psi_full.critical',
        'host',
        'critical',
        'Linux memory PSI full stalls reached the critical band while memory was below reserve.',
        'memoryPressureFullAvg10',
        full,
        LINUX_MEMORY_PRESSURE_DEFAULTS.fullCriticalAvg10,
      ));
    }
    if (swapActivity != null
      && swapActivity >= LINUX_MEMORY_PRESSURE_DEFAULTS.swapActivityCriticalBytesPerMinute) {
      results.push(reason(
        'host.linux.swap_activity.critical',
        'host',
        'critical',
        'Linux swap activity reached the critical band while memory was below reserve.',
        'swapActivityBytesPerMinute',
        swapActivity,
        LINUX_MEMORY_PRESSURE_DEFAULTS.swapActivityCriticalBytesPerMinute,
      ));
    }
  }

  if (admission.state === 'soft' || admission.state === 'blocked') {
    if (some != null && some >= LINUX_MEMORY_PRESSURE_DEFAULTS.someWarningAvg10) {
      results.push(reason(
        'host.linux.psi_some.warning',
        'host',
        'warning',
        'Linux memory PSI some stalls reached the warning band while memory was below reserve.',
        'memoryPressureSomeAvg10',
        some,
        LINUX_MEMORY_PRESSURE_DEFAULTS.someWarningAvg10,
      ));
    }
    if (swapActivity != null
      && swapActivity >= LINUX_MEMORY_PRESSURE_DEFAULTS.swapActivityWarningBytesPerMinute
      && !(admission.state === 'blocked'
        && swapActivity >= LINUX_MEMORY_PRESSURE_DEFAULTS.swapActivityCriticalBytesPerMinute)) {
      results.push(reason(
        'host.linux.swap_activity.warning',
        'host',
        'warning',
        'Linux swap activity reached the warning band while memory was below reserve.',
        'swapActivityBytesPerMinute',
        swapActivity,
        LINUX_MEMORY_PRESSURE_DEFAULTS.swapActivityWarningBytesPerMinute,
      ));
    }
  }

  return results;
}

function darwinPressureReasons(sample: HostMetricSample): HealthReason[] {
  const freePercent = value(sample.memoryPressureFreePercent);
  if (freePercent == null) return [];
  if (freePercent <= DARWIN_MEMORY_PRESSURE_DEFAULTS.criticalFreePercent) {
    return [reason(
      'host.darwin.memory_pressure.critical',
      'host',
      'critical',
      'macOS memory pressure free percentage reached the critical band.',
      'memoryPressureFreePercent',
      freePercent,
      DARWIN_MEMORY_PRESSURE_DEFAULTS.criticalFreePercent,
    )];
  }
  if (freePercent <= DARWIN_MEMORY_PRESSURE_DEFAULTS.warningFreePercent) {
    return [reason(
      'host.darwin.memory_pressure.warning',
      'host',
      'warning',
      'macOS memory pressure free percentage reached the warning band.',
      'memoryPressureFreePercent',
      freePercent,
      DARWIN_MEMORY_PRESSURE_DEFAULTS.warningFreePercent,
    )];
  }
  return [];
}

function hasCurrentPressureSignal(sample: HostMetricSample): boolean {
  if (sample.platform === 'linux') {
    return value(sample.memoryPressureSomeAvg10) != null
      || value(sample.memoryPressureFullAvg10) != null
      || value(sample.swapActivityBytesPerMinute) != null;
  }
  if (sample.platform === 'darwin') return value(sample.memoryPressureFreePercent) != null;
  return false;
}

export function evaluateHostPressure(
  sample: HostMetricSample,
  thresholds: SystemHealthThresholds,
): HostPressureAssessment {
  const admission = evaluateAdmission(sample, thresholds);
  const diagnosticReasons = diagnostics(sample, thresholds);

  if (!hasCurrentPressureSignal(sample)) {
    const unavailableReason: HealthReason = {
      code: 'host.current_pressure.unavailable',
      domain: 'host',
      severity: 'info',
      message: 'The platform collector could not measure a current-pressure signal.',
    };
    return {
      state: 'unavailable',
      reasons: [unavailableReason, ...diagnosticReasons],
      diagnostics: diagnosticReasons,
      admission,
    };
  }

  const pressureReasons = sample.platform === 'linux'
    ? linuxPressureReasons(sample, admission)
    : darwinPressureReasons(sample);
  const state: HealthState = pressureReasons.some((entry) => entry.severity === 'critical')
    ? 'critical'
    : pressureReasons.some((entry) => entry.severity === 'warning')
      ? 'warning'
      : 'healthy';

  return {
    state,
    reasons: [...pressureReasons, ...diagnosticReasons],
    diagnostics: diagnosticReasons,
    admission,
  };
}
