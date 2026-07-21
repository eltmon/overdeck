import { renameSync, writeFileSync } from 'node:fs';

const request = JSON.parse(process.argv[2]);
await new Promise((resolve) => setTimeout(resolve, Number(process.env.VERIFICATION_FIXTURE_DELAY_MS ?? 100)));
const temp = `${request.resultPath}.${process.pid}.tmp`;
const result = process.env.VERIFICATION_FIXTURE_ECHO_OPTIONS === '1'
  ? { outcome: 'passed', options: request.options }
  : { outcome: 'passed' };
writeFileSync(temp, `${JSON.stringify(result)}\n`);
renameSync(temp, request.resultPath);
