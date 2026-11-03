/**
 * Phone app entry (PAN-4837 D-3). Static imports are hoisted, so only modules that never read
 * `__OVERDECK_NATIVE__` (the stylesheet, React DOM) are imported statically; the shell, and through
 * it every frontend module, loads after the flag is set.
 */
import '../../../src/dashboard/frontend/src/index.css';

import { createRoot } from 'react-dom/client';

(globalThis as { __OVERDECK_NATIVE__?: boolean }).__OVERDECK_NATIVE__ = true;

const { default: ShellApp } = await import('./shell/ShellApp');
createRoot(document.getElementById('root')!).render(<ShellApp />);
