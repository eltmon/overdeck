#!/usr/bin/env node
/**
 * verify-deep-link-latency.mjs — measure the deep-linked issue read and the
 * drawer title against a live dashboard (PAN-5178).
 *
 * A tab open sends about 45 REST requests in one React commit. Before the
 * fix, the drawer's `GET /api/issues/<ID>` and the session mint were issued
 * last in that burst and waited behind it. This script opens `<base>/?issue=
 * <ID>` in a fresh Chromium context per run and measures how long the issue
 * read actually took, and how long the drawer took to show the real title.
 *
 * Usage:
 *   node scripts/verify-deep-link-latency.mjs --issue PAN-5170 [options]
 *
 * Options:
 *   --base-url URL   Dashboard base URL (default: http://127.0.0.1:3011)
 *   --issue ID       Issue to deep-link to (required)
 *   --runs N         Number of runs (default: 3)
 *   --assert         Exit 1 if a threshold is exceeded
 *   --help           Print this usage and exit 0
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3011'
const ISSUE_READ_TOTAL_LIMIT_MS = 300
const TITLE_AFTER_DCL_LIMIT_MS = 1_000
const INTERNAL_TOKEN_HEADER = 'x-overdeck-internal-token'

function printHelp() {
  console.log([
    'Usage: node scripts/verify-deep-link-latency.mjs --issue ID [options]',
    '',
    'Options:',
    '  --base-url URL   Dashboard base URL (default: http://127.0.0.1:3011)',
    '  --issue ID       Issue to deep-link to (required)',
    '  --runs N         Number of runs (default: 3)',
    '  --assert         Exit 1 if a threshold is exceeded',
    '  --help           Print this usage and exit 0',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = { baseUrl: DEFAULT_BASE_URL, issue: null, runs: 3, assert: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--base-url') options.baseUrl = argv[++index]
    else if (arg === '--issue') options.issue = argv[++index]
    else if (arg === '--runs') options.runs = Number(argv[++index])
    else if (arg === '--assert') options.assert = true
    else if (arg === '--help') { printHelp(); process.exit(0) }
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function readInternalToken() {
  const home = process.env.OVERDECK_HOME || join(homedir(), '.overdeck')
  try {
    return readFileSync(join(home, 'internal-token'), 'utf8').trim()
  } catch {
    return null
  }
}

async function readRealTitle(baseUrl, issue, token) {
  const response = await fetch(`${baseUrl}/api/issues/${encodeURIComponent(issue)}`, {
    headers: { [INTERNAL_TOKEN_HEADER]: token },
  })
  if (response.status !== 200) {
    throw new Error(`GET /api/issues/${issue} returned HTTP ${response.status}`)
  }
  const body = await response.json()
  return body.title
}

async function runOnce(baseUrl, issue, token, realTitle) {
  const issuePath = `/api/issues/${issue}`
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    const dashboardOrigin = new URL(baseUrl).origin
    // extraHTTPHeaders would send this root credential to every origin the
    // context reaches, including a cross-origin telemetry endpoint when
    // enabled. Attach it only to requests the dashboard itself will see.
    await context.route('**/*', async (route) => {
      const request = route.request()
      let origin
      try {
        origin = new URL(request.url()).origin
      } catch {
        await route.continue()
        return
      }
      if (origin !== dashboardOrigin) {
        await route.continue()
        return
      }
      await route.continue({ headers: { ...request.headers(), [INTERNAL_TOKEN_HEADER]: token } })
    })
    const page = await context.newPage()

    const firstApiRequests = []
    let issueReadTotalMs = null
    let issueReadQueuedMs = null
    let issueReadTtfbMs = null
    const issueRequestStartedAt = new Map()

    page.on('request', (request) => {
      let pathname
      try {
        pathname = new URL(request.url()).pathname
      } catch {
        return
      }
      if (!pathname.startsWith('/api/')) return
      if (firstApiRequests.length < 5) firstApiRequests.push(pathname)
      if (pathname === issuePath && issueReadTotalMs === null && !issueRequestStartedAt.has(request)) {
        issueRequestStartedAt.set(request, Date.now())
      }
    })
    page.on('requestfinished', (request) => {
      if (!issueRequestStartedAt.has(request)) return
      if (issueReadTotalMs !== null) return
      const startedAt = issueRequestStartedAt.get(request)
      issueReadTotalMs = Date.now() - startedAt
      const timing = request.timing()
      issueReadQueuedMs = timing.requestStart
      issueReadTtfbMs = timing.responseStart - timing.requestStart
    })

    let dclAt = null
    page.once('domcontentloaded', () => { dclAt = Date.now() })

    // The default waitUntil ('load') would block until every unrelated
    // resource finishes, delaying the title check past when the title
    // actually appeared and inflating the measured dcl-to-title gap.
    await page.goto(`${baseUrl}/?issue=${encodeURIComponent(issue)}`, { waitUntil: 'domcontentloaded' })

    await page.waitForFunction(
      (title) => document.querySelector('[data-testid="issue-drawer"]')?.textContent?.includes(title) ?? false,
      realTitle,
      { timeout: 10_000 },
    )
    const titleAt = Date.now()

    return {
      total: issueReadTotalMs,
      queued: issueReadQueuedMs,
      ttfb: issueReadTtfbMs,
      titleAfterDclMs: dclAt === null ? null : titleAt - dclAt,
      firstApiRequests,
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.issue) {
    console.error('Missing required argument: --issue')
    process.exitCode = 2
    return
  }
  if (!Number.isFinite(options.runs) || options.runs <= 0) {
    throw new Error('--runs must be a positive number')
  }

  const token = readInternalToken()
  if (!token) {
    console.error('No internal token found at $OVERDECK_HOME/internal-token or ~/.overdeck/internal-token')
    process.exitCode = 2
    return
  }

  const realTitle = await readRealTitle(options.baseUrl, options.issue, token)

  let failed = false
  for (let run = 1; run <= options.runs; run++) {
    const result = await runOnce(options.baseUrl, options.issue, token, realTitle)
    console.log(
      `run ${run}: issue read total=${result.total}ms queued=${result.queued}ms ttfb=${result.ttfb}ms, `
      + `title at dcl+${result.titleAfterDclMs}ms, first requests: ${result.firstApiRequests.join(', ')}`,
    )
    if (result.total === null || result.total >= ISSUE_READ_TOTAL_LIMIT_MS) failed = true
    if (result.titleAfterDclMs === null || result.titleAfterDclMs >= TITLE_AFTER_DCL_LIMIT_MS) failed = true
  }

  if (options.assert && failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
