import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getFlywheelRunDir } from '../../dashboard/server/services/flywheel-run-state.js';
import {
  checkActiveOrderDispatch,
  recordOffBookOverride,
  type ActiveOrderDispatchCheck,
  type ActiveOrderDispatchDeps,
} from './dispatch-gate.js';

interface StoredOrderDispatchReservation {
  id: string;
  bookId: string;
  issueId: string;
  reservedAt: string;
}

export class OrderDispatchReservationError extends Error {
  constructor(readonly check: ActiveOrderDispatchCheck) {
    super(check.decision.message ?? 'Order-book dispatch is blocked.');
    this.name = 'OrderDispatchReservationError';
  }
}

export interface OrderDispatchReservation {
  check: ActiveOrderDispatchCheck;
  release: () => Promise<void>;
}

export interface OrderDispatchReservationDeps extends ActiveOrderDispatchDeps {
  reservationRoot?: (runId: string) => string;
  now?: () => Date;
  staleMs?: number;
  recordOverride?: typeof recordOffBookOverride;
}

const DEFAULT_STALE_MS = 15 * 60 * 1000;
const processLocks = new Map<string, Promise<void>>();
let reservationSequence = 0;

async function withProcessLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = processLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  processLocks.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (processLocks.get(key) === tail) processLocks.delete(key);
  }
}

function paths(root: string) {
  return {
    state: join(root, 'orders-dispatch-reservations.json'),
    temp: join(root, `orders-dispatch-reservations.${process.pid}.tmp`),
    lock: join(root, 'orders-dispatch-reservations.lock'),
  };
}

async function acquireFileLock(path: string, staleMs: number, now: Date): Promise<void> {
  try {
    await mkdir(path);
    return;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code !== 'EEXIST') throw error;
  }

  const age = await stat(path).then((value) => now.getTime() - value.mtimeMs).catch(() => 0);
  if (age <= staleMs) {
    throw new Error('Another order-book dispatch admission is in progress; retry after it finishes.');
  }
  await rm(path, { recursive: true, force: true });
  await mkdir(path);
}

async function readReservations(path: string): Promise<StoredOrderDispatchReservation[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed as StoredOrderDispatchReservation[] : [];
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return [];
    throw error;
  }
}

async function writeReservations(path: string, tempPath: string, reservations: readonly StoredOrderDispatchReservation[]): Promise<void> {
  await writeFile(tempPath, `${JSON.stringify(reservations, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, path);
}

function freshReservations(
  reservations: readonly StoredOrderDispatchReservation[],
  now: Date,
  staleMs: number,
): StoredOrderDispatchReservation[] {
  return reservations.filter((reservation) => {
    const reservedAt = Date.parse(reservation.reservedAt);
    return Number.isFinite(reservedAt) && now.getTime() - reservedAt <= staleMs;
  });
}

export async function reserveActiveOrderDispatch(
  projectRoot: string,
  issueId: string,
  options: { offBook?: boolean; recordOverride?: boolean } = {},
  deps: OrderDispatchReservationDeps = {},
): Promise<OrderDispatchReservation> {
  const initial = await checkActiveOrderDispatch(projectRoot, issueId, options, deps);
  if (!initial.ordersBound || !initial.runId || !initial.bookId || !initial.decision.eligible) {
    return { check: initial, release: async () => {} };
  }

  const root = (deps.reservationRoot ?? getFlywheelRunDir)(initial.runId);
  await mkdir(root, { recursive: true });
  const reservationPaths = paths(root);
  const staleMs = deps.staleMs ?? DEFAULT_STALE_MS;
  const now = (deps.now ?? (() => new Date()))();
  const reservationId = `${process.pid}-${now.getTime()}-${reservationSequence++}`;
  let check = initial;

  await withProcessLock(reservationPaths.lock, async () => {
    await acquireFileLock(reservationPaths.lock, staleMs, now);
    try {
      const current = freshReservations(await readReservations(reservationPaths.state), now, staleMs);
      check = await checkActiveOrderDispatch(projectRoot, issueId, options, {
        ...deps,
        reservedIssues: new Set(current
          .filter((reservation) => reservation.bookId === initial.bookId)
          .map((reservation) => reservation.issueId)),
      });
      if (!check.decision.eligible) return;
      current.push({
        id: reservationId,
        bookId: initial.bookId!,
        issueId: issueId.toUpperCase(),
        reservedAt: now.toISOString(),
      });
      await writeReservations(reservationPaths.state, reservationPaths.temp, current);
    } finally {
      await rm(reservationPaths.lock, { recursive: true, force: true });
    }
  });

  if (!check.decision.eligible) return { check, release: async () => {} };
  if (options.recordOverride && check.decision.overrideUsed) {
    await (deps.recordOverride ?? recordOffBookOverride)(initial.runId, initial.bookId, issueId);
  }

  let released = false;
  return {
    check,
    release: async () => {
      if (released) return;
      released = true;
      const releasedAt = (deps.now ?? (() => new Date()))();
      await withProcessLock(reservationPaths.lock, async () => {
        await acquireFileLock(reservationPaths.lock, staleMs, releasedAt);
        try {
          const current = freshReservations(await readReservations(reservationPaths.state), releasedAt, staleMs)
            .filter((reservation) => reservation.id !== reservationId);
          await writeReservations(reservationPaths.state, reservationPaths.temp, current);
        } finally {
          await rm(reservationPaths.lock, { recursive: true, force: true });
        }
      });
    },
  };
}

export async function withActiveOrderDispatchReservation<T>(
  projectRoot: string,
  issueId: string,
  options: { offBook?: boolean; recordOverride?: boolean },
  action: () => Promise<T>,
  deps: OrderDispatchReservationDeps = {},
): Promise<{ check: ActiveOrderDispatchCheck; result?: T }> {
  const reservation = await reserveActiveOrderDispatch(projectRoot, issueId, options, deps);
  if (!reservation.check.decision.eligible) return { check: reservation.check };
  try {
    return { check: reservation.check, result: await action() };
  } finally {
    await reservation.release();
  }
}
