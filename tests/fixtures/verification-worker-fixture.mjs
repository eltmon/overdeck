import { renameSync, writeFileSync } from 'node:fs';

const request = JSON.parse(process.argv[2]);
await new Promise((resolve) => setTimeout(resolve, Number(process.env.VERIFICATION_FIXTURE_DELAY_MS ?? 100)));
const temp = `${request.resultPath}.${process.pid}.tmp`;
writeFileSync(temp, `${JSON.stringify({ outcome: 'passed' })}\n`);
renameSync(temp, request.resultPath);
