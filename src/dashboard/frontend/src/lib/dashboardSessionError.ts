/**
 * Split out of wsTransport.ts (PAN-1166 review) so callers that only need to
 * catch a refused session mint don't depend on wsTransport's export surface.
 * Six e2e/Playwright specs replace wsTransport.ts wholesale with an inline
 * Vite-transform stub that mocks the RPC transport; none of them need to
 * track this class, so it lives in its own module those stubs never touch.
 */
export class DashboardSessionUnauthorizedError extends Error {
  constructor(readonly sessionUrl: string) {
    super(`Dashboard session mint was refused (HTTP 401) at ${sessionUrl}`)
    this.name = 'DashboardSessionUnauthorizedError'
  }
}
