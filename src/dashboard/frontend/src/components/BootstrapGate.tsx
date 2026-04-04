import { type ReactNode } from 'react'
import { useDashboardStore, selectIsBootstrapped } from '../lib/store'

interface BootstrapGateProps {
  fallback: ReactNode
  children: ReactNode
}

/**
 * Renders `fallback` until the initial RPC snapshot has loaded (bootstrapComplete),
 * then renders `children`. Prevents store-consuming views from flashing zero/empty
 * states while `getSnapshot` is in flight.
 */
export function BootstrapGate({ fallback, children }: BootstrapGateProps) {
  const isBootstrapped = useDashboardStore(selectIsBootstrapped)
  return isBootstrapped ? <>{children}</> : <>{fallback}</>
}
