import { describe, expect, it } from 'vitest'

import {
  isQualityGateCpuPressured,
  QUALITY_GATE_CONTENDED_UTILIZATION_FLOOR,
  QUALITY_GATE_CPU_START_THRESHOLD,
} from '../../../../src/lib/cloister/quality-gate-cpu.js'

describe('isQualityGateCpuPressured (PAN-5589)', () => {
  const psiStartAvg10 = 25

  it.each([
    [0.49, 99, 0, false],
    [0.5, 25, 0, true],
    [0.5, 24.9, 0, false],
    [0.74, 0, 0, false],
    [0.75, 0, 0, true],
    [0.49, null, 5, false],
    [0.5, null, 1, true],
    [0.5, null, 0.99, false],
  ])('cpuUtilization %s, psiSomeAvg10 %s, loadPerCore %s -> pressured %s', (cpuUtilization, psiSomeAvg10, loadPerCore, expected) => {
    expect(isQualityGateCpuPressured({ cpuUtilization, loadPerCore, psiSomeAvg10 }, psiStartAvg10)).toBe(expected)
  })

  it('exposes the contended-utilization floor and the CPU start threshold', () => {
    expect(QUALITY_GATE_CONTENDED_UTILIZATION_FLOOR).toBe(0.5)
    expect(QUALITY_GATE_CPU_START_THRESHOLD).toBe(0.75)
  })
})
