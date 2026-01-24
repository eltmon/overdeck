/**
 * Request Lock Context (PAN-88)
 *
 * Prevents concurrent API requests that cause Claude API 400 errors.
 * Only one action can be in flight at a time across the entire dashboard.
 *
 * Usage:
 *   const { isLocked, withLock } = useRequestLock();
 *
 *   // Disable buttons when locked
 *   <button disabled={isLocked}>Action</button>
 *
 *   // Wrap API calls
 *   await withLock(async () => {
 *     await fetch('/api/action');
 *   });
 */

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface RequestLockContextType {
  /** True if any request is currently in flight */
  isLocked: boolean;

  /** Current action description (for UI feedback) */
  currentAction: string | null;

  /**
   * Execute an async function with the lock held.
   * If already locked, the request is rejected immediately.
   *
   * @param action - Description of the action (shown in UI)
   * @param fn - Async function to execute
   * @returns Promise that resolves when fn completes
   * @throws Error if already locked
   */
  withLock: <T>(action: string, fn: () => Promise<T>) => Promise<T>;

  /**
   * Check if lock can be acquired (for UI feedback before attempting)
   */
  canAcquire: () => boolean;
}

const RequestLockContext = createContext<RequestLockContextType | null>(null);

export function RequestLockProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(false);
  const [currentAction, setCurrentAction] = useState<string | null>(null);

  const canAcquire = useCallback(() => !isLocked, [isLocked]);

  const withLock = useCallback(async <T,>(action: string, fn: () => Promise<T>): Promise<T> => {
    if (isLocked) {
      throw new Error(`Cannot perform "${action}" - another action is in progress: ${currentAction}`);
    }

    setIsLocked(true);
    setCurrentAction(action);

    try {
      return await fn();
    } finally {
      setIsLocked(false);
      setCurrentAction(null);
    }
  }, [isLocked, currentAction]);

  return (
    <RequestLockContext.Provider value={{ isLocked, currentAction, withLock, canAcquire }}>
      {children}
    </RequestLockContext.Provider>
  );
}

export function useRequestLock(): RequestLockContextType {
  const context = useContext(RequestLockContext);
  if (!context) {
    throw new Error('useRequestLock must be used within a RequestLockProvider');
  }
  return context;
}

/**
 * Global loading indicator component
 * Shows when any request is in flight
 */
export function GlobalRequestIndicator() {
  const { isLocked, currentAction } = useRequestLock();

  if (!isLocked) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-black px-4 py-2 text-center font-medium shadow-lg">
      <span className="animate-pulse">⏳ {currentAction || 'Processing...'}...</span>
      <span className="ml-2 text-yellow-800 text-sm">
        (All actions disabled until complete)
      </span>
    </div>
  );
}
