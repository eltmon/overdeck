/**
 * Client side of the Prime Agent host control socket (PAN-3668). Posts one op to
 * `$OVERDECK_HOME/sockets/prime-agent-<agentId>.sock` with the agent's bridge token.
 * Used by the Cloister runtime adapter for `interrupt`; delivery goes through the
 * shared delivery door instead.
 */
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

import { BRIDGE_TOKEN_HEADER } from '../bridge-token.js';
import { getOverdeckHome } from '../paths.js';
import { hostSocketPath, hostTokenFile } from '../runtimes/host-transport.js';

export async function postPrimeAgentHostOp(
  agentId: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  home = getOverdeckHome(),
): Promise<{ status: number; body: string }> {
  const token = (await readFile(join(home, 'agents', agentId, hostTokenFile('prime-agent')), 'utf8')).trim();
  if (!token) throw new Error(`Prime Agent host token missing for ${agentId}`);
  const payload = JSON.stringify(body);
  return new Promise((resolvePost, reject) => {
    const req = httpRequest({
      socketPath: hostSocketPath(agentId, 'prime-agent', home),
      path: '/',
      method: 'POST',
      agent: false,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        [BRIDGE_TOKEN_HEADER]: token,
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) resolvePost({ status, body: text });
        else reject(new Error(`Prime Agent host ${String(body.op)} returned status ${status}`));
      });
    });
    const timer = setTimeout(() => {
      req.destroy(new Error(`Prime Agent host ${String(body.op)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end(payload);
  });
}
