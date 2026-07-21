import { requestStrikeMerge } from '../../src/lib/cloister/deacon-strike-landing.ts';

process.once('message', async ({ issueId, request }) => {
  const result = await requestStrikeMerge(issueId, request);
  process.send?.(result);
  process.disconnect();
});
