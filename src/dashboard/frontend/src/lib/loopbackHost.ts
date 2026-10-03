/** True when the dashboard hostname resolves to this machine (PAN-4464). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host === '::1' || host === '[::1]'
    || /^127(\.\d{1,3}){3}$/.test(host);
}
