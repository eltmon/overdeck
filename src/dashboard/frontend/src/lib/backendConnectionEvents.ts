export const BACKEND_RECONNECTING_EVENT = 'overdeck:backend-reconnecting'
export const BACKEND_RECONNECTED_EVENT = 'overdeck:reconnected'

export function dispatchBackendReconnecting(): void {
  window.dispatchEvent(new CustomEvent(BACKEND_RECONNECTING_EVENT))
}

export function dispatchBackendReconnected(): void {
  window.dispatchEvent(new CustomEvent(BACKEND_RECONNECTED_EVENT))
}
