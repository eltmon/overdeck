/**
 * Phone app entry (PAN-4837). Static imports are hoisted, so only modules that never read
 * `__OVERDECK_NATIVE__` (the stylesheet, React DOM) are imported statically; frontend modules load
 * after the flag is set.
 */
import '../../../src/dashboard/frontend/src/index.css';

import { createRoot } from 'react-dom/client';

(globalThis as { __OVERDECK_NATIVE__?: boolean }).__OVERDECK_NATIVE__ = true;

createRoot(document.getElementById('root')!).render(<main data-component="mobile-shell">Overdeck</main>);
