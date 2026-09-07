/**
 * Native Kimi K3 accepts three effort levels. Claude-compatible saved values
 * retain their documented meaning at the native boundary. K2.7 Code always
 * thinks and does not expose adjustable effort.
 * https://www.kimi.com/code/docs/en/kimi-code/models.html
 */
export function resolveKimiNativeEffort(model: string, effort = 'high'): 'low' | 'high' | 'max' | undefined {
  if (!['k3', 'k3-256k', 'k3[1m]', 'kimi-code/k3', 'kimi-code/k3-256k'].includes(model)) {
    return undefined;
  }
  switch (effort) {
    case 'low': return 'low';
    case 'medium':
    case 'high': return 'high';
    case 'xhigh':
    case 'max': return 'max';
    default: throw new Error(`Invalid Kimi K3 effort "${effort}"; choose low, high, or max.`);
  }
}
