import { runSupervisedVerification } from '../../src/lib/cloister/verification-worker-supervisor.js';

await runSupervisedVerification(
  'PAN-2597',
  '/tmp/workspace',
  { isRemote: false },
  'parent-fixture',
);
