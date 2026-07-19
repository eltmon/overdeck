#!/usr/bin/env node

import { readFile, readdir, readlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'

const DEFAULT_DURATION_SECONDS = 65
const DEFAULT_BASE_URL = 'http://127.0.0.1:3011'
const ROUTES = [
  '/api/health',
  '/api/registered-projects',
  '/api/issues/resource-allocated',
  '/api/resources',
]

function parseArgs(argv) {
  const options = {
    pid: null,
    baseUrl: DEFAULT_BASE_URL,
    durationSeconds: DEFAULT_DURATION_SECONDS,
    childPollMs: 25,
    routePollMs: 1_000,
    assert: false,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--pid') options.pid = Number(argv[++index])
    else if (arg === '--base-url') options.baseUrl = argv[++index]
    else if (arg === '--duration') options.durationSeconds = Number(argv[++index])
    else if (arg === '--child-poll-ms') options.childPollMs = Number(argv[++index])
    else if (arg === '--route-poll-ms') options.routePollMs = Number(argv[++index])
    else if (arg === '--assert') options.assert = true
    else if (arg === '--help') {
      console.log('Usage: node scripts/verify-dashboard-performance.mjs [--pid PID] [--base-url URL] [--duration SECONDS] [--assert]')
      process.exit(0)
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
    throw new Error('--duration must be a positive number')
  }
  if (!Number.isFinite(options.childPollMs) || options.childPollMs <= 0) {
    throw new Error('--child-poll-ms must be a positive number')
  }
  return options
}

async function findDashboardPid(repoRoot) {
  const entries = await readdir('/proc', { withFileTypes: true })
  const matches = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number(entry.name)
    try {
      const [comm, cmdline, cwd] = await Promise.all([
        readFile(`/proc/${pid}/comm`, 'utf8'),
        readFile(`/proc/${pid}/cmdline`, 'utf8'),
        readlink(`/proc/${pid}/cwd`),
      ])
      if (comm.trim() !== 'node') continue
      if (!cmdline.replaceAll('\0', ' ').includes('dist/dashboard/server.js')) continue
      if (resolve(cwd) !== repoRoot) continue
      matches.push(pid)
    } catch {
      // Process exited during the census.
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected one dashboard process in ${repoRoot}, found ${matches.length}: ${matches.join(', ') || 'none'}. Pass --pid explicitly.`)
  }
  return matches[0]
}

async function readCpuTicks(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
  const commandEnd = stat.lastIndexOf(')')
  if (commandEnd < 0) throw new Error(`Malformed /proc/${pid}/stat`)
  const fields = stat.slice(commandEnd + 2).trim().split(/\s+/)
  const userTicks = Number(fields[11])
  const systemTicks = Number(fields[12])
  if (!Number.isFinite(userTicks) || !Number.isFinite(systemTicks)) {
    throw new Error(`Missing CPU fields in /proc/${pid}/stat`)
  }
  return userTicks + systemTicks
}

async function readDirectChildren(pid) {
  try {
    const text = await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')
    return text.trim() ? text.trim().split(/\s+/).map(Number).filter(Number.isFinite) : []
  } catch {
    return []
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function percentile(values, fraction) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return Math.round(sorted[index] * 100) / 100
}

async function measureRoute(baseUrl, route) {
  const started = performance.now()
  const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(5_000) })
  await response.arrayBuffer()
  const durationMs = performance.now() - started
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`)
  return durationMs
}

async function pollChildren(pid, durationMs, pollMs) {
  const initial = await readDirectChildren(pid)
  const seen = new Set(initial)
  let creations = 0
  const deadline = performance.now() + durationMs
  while (performance.now() < deadline) {
    for (const childPid of await readDirectChildren(pid)) {
      if (seen.has(childPid)) continue
      seen.add(childPid)
      creations += 1
    }
    await sleep(pollMs)
  }
  return creations
}

async function pollRoutes(baseUrl, durationMs, pollMs) {
  const samples = Object.fromEntries(ROUTES.map((route) => [route, []]))
  const failures = []
  const deadline = performance.now() + durationMs
  while (performance.now() < deadline) {
    await Promise.all(ROUTES.map(async (route) => {
      try {
        samples[route].push(await measureRoute(baseUrl, route))
      } catch (error) {
        failures.push(`${route}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }))
    await sleep(pollMs)
  }
  return { samples, failures }
}

async function readEventLoopSample(baseUrl) {
  const response = await fetch(`${baseUrl}/api/metrics/summary`, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`/api/metrics/summary returned HTTP ${response.status}`)
  const payload = await response.json()
  return payload.eventLoop ?? null
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const repoRoot = resolve(process.cwd())
  const pid = options.pid ?? await findDashboardPid(repoRoot)
  const durationMs = options.durationSeconds * 1_000
  const startedAt = performance.now()
  const initialCpuTicks = await readCpuTicks(pid)

  const [childCreations, routeResult] = await Promise.all([
    pollChildren(pid, durationMs, options.childPollMs),
    pollRoutes(options.baseUrl, durationMs, options.routePollMs),
  ])

  const elapsedSeconds = (performance.now() - startedAt) / 1_000
  const finalCpuTicks = await readCpuTicks(pid)
  // Linux USER_HZ is 100 on supported Overdeck hosts. This matches top/ps %CPU:
  // 100% means one fully occupied core.
  const cpuPercent = ((finalCpuTicks - initialCpuTicks) / 100) / elapsedSeconds * 100
  const childProcessesPerSecond = childCreations / elapsedSeconds
  const routeLatency = Object.fromEntries(Object.entries(routeResult.samples).map(([route, values]) => [
    route,
    { samples: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) },
  ]))
  const eventLoop = await readEventLoopSample(options.baseUrl)

  const checks = {
    cpuBelow15Percent: cpuPercent < 15,
    childRateBelow2PerSecond: childProcessesPerSecond < 2,
    eventLoopP99Below100Ms: typeof eventLoop?.p99 === 'number' && eventLoop.p99 < 100,
    routeP95Below200Ms: Object.values(routeLatency).every((sample) => sample.p95Ms !== null && sample.p95Ms < 200),
    noRouteFailures: routeResult.failures.length === 0,
  }
  const result = {
    pid,
    baseUrl: options.baseUrl,
    durationSeconds: Math.round(elapsedSeconds * 100) / 100,
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    directChildCreations: childCreations,
    directChildProcessesPerSecond: Math.round(childProcessesPerSecond * 100) / 100,
    routeLatency,
    routeFailures: routeResult.failures,
    eventLoop,
    checks,
    passed: Object.values(checks).every(Boolean),
  }
  console.log(JSON.stringify(result, null, 2))
  if (options.assert && !result.passed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
