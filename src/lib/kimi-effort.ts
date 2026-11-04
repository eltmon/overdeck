/**
 * Native Kimi K3 and K3.1 accept three effort levels. Claude-compatible saved
 * values retain their documented meaning at the native boundary. K2.8 Preview
 * (kimi-code/kimi-for-coding) accepts low/high/max; K2.7 Code Highspeed always
 * thinks without adjustable effort. Callers pass a level
 * already resolved by resolveEffort; this function only translates.
 * https://www.kimi.com/code/docs/en/kimi-code/models.html
 */
export function resolveKimiNativeEffort(model: string, effort: string | undefined): 'low' | 'high' | 'max' | undefined {
  if (!['k3', 'k3-256k', 'k3[1m]', 'kimi-code/k3', 'kimi-code/k3-256k', 'k3.1-pro', 'k3.1-pro-highspeed', 'kimi-code/k3.1-pro', 'kimi-code/k3.1-pro-highspeed', 'kimi-code/kimi-for-coding'].includes(model)) {
    return undefined;
  }
  if (effort === undefined) throw new Error(`Kimi K3/K3.1/K2.8 launch for "${model}" requires a resolved effort level.`);
  switch (effort) {
    case 'low': return 'low';
    case 'medium':
    case 'high': return 'high';
    case 'xhigh':
    case 'max': return 'max';
    default: throw new Error(`Invalid Kimi K3/K3.1/K2.8 effort "${effort}"; choose low, high, or max.`);
  }
}
