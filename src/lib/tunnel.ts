/**
 * Cloudflare Tunnel Management
 *
 * Manages tunnel ingress rules and DNS CNAME records for workspace lifecycle.
 * Called during workspace create (addTunnelIngress) and workspace remove/deep-wipe (removeTunnelIngress).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { TunnelConfig, TunnelHostname, TemplatePlaceholders, replacePlaceholdersSync } from './workspace-config.js';
import { TrackerError } from './errors.js';

export interface TunnelResult {
  success: boolean;
  steps: string[];
}

interface CloudflareCredentials {
  apiToken: string;
  accountId: string;
  zoneId: string;
}

interface CloudflareIngressRule {
  service: string;
  hostname?: string;
  originRequest?: Record<string, unknown>;
}

interface CloudflareTunnelConfig {
  config: {
    ingress: CloudflareIngressRule[];
  };
}

const CF_API = 'https://api.cloudflare.com/client/v4';
const FETCH_TIMEOUT = 10_000;

/**
 * Read API token from Cloudflare cert.pem file.
 * The cert.pem contains a PEM-wrapped base64 JSON blob with { zoneID, accountID, apiToken }.
 */
function readCloudflareCredentials(certPath: string): CloudflareCredentials | null {
  try {
    const resolvedPath = certPath.replace(/^~/, homedir());
    const pem = readFileSync(resolve(resolvedPath), 'utf-8');
    // Strip PEM headers/trailers and decode
    const b64 = pem
      .split('\n')
      .filter(line => !line.startsWith('-----'))
      .join('');
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    return {
      apiToken: json.apiToken,
      accountId: json.accountID,
      zoneId: json.zoneID,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Make an authenticated Cloudflare API request.
 */
async function cfFetch(
  path: string,
  apiToken: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<{ ok: boolean; data: any; errors?: any[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(`${CF_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await resp.json() as any;
    return { ok: json.success !== false, data: json.result, errors: json.errors };
  } catch (err: any) {
    return { ok: false, data: null, errors: [{ message: err.message }] };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve hostnames from config, replacing template placeholders.
 */
function resolveHostnames(
  hostnames: TunnelHostname[],
  placeholders: TemplatePlaceholders,
): Array<{ hostname: string; httpHostHeader?: string; noTlsVerify: boolean }> {
  return hostnames.map(h => ({
    hostname: replacePlaceholdersSync(h.pattern, placeholders),
    httpHostHeader: h.http_host_header ? replacePlaceholdersSync(h.http_host_header, placeholders) : undefined,
    noTlsVerify: h.no_tls_verify !== false, // default true
  }));
}async function addTunnelIngressPromise(
  config: TunnelConfig,
  placeholders: TemplatePlaceholders,
): Promise<TunnelResult> {
  const steps: string[] = [];
  let allOk = true;

  // Read credentials
  const creds = readCloudflareCredentials(config.credentials_file);
  if (!creds) {
    return { success: false, steps: ['[tunnel] Failed to read Cloudflare credentials from ' + config.credentials_file] };
  }
  steps.push('[tunnel] Read Cloudflare credentials');

  const resolved = resolveHostnames(config.hostnames, placeholders);

  // Get current tunnel configuration
  const tunnelPath = `/accounts/${creds.accountId}/cfd_tunnel/${config.tunnel_id}/configurations`;
  const current = await cfFetch(tunnelPath, creds.apiToken);
  if (!current.ok) {
    return { success: false, steps: [...steps, `[tunnel] Failed to get tunnel config: ${JSON.stringify(current.errors)}`] };
  }

  const tunnelConfig: CloudflareTunnelConfig = current.data;
  const ingress: CloudflareIngressRule[] = tunnelConfig.config?.ingress || [];
  steps.push(`[tunnel] Current tunnel config has ${ingress.length} ingress rules`);

  // Add new ingress rules (before the catch-all)
  let modified = false;
  for (const h of resolved) {
    // Skip if rule already exists
    if (ingress.some(r => r.hostname === h.hostname)) {
      steps.push(`[tunnel] Ingress rule for ${h.hostname} already exists, skipping`);
      continue;
    }

    const originRequest: Record<string, unknown> = {};
    if (h.noTlsVerify) originRequest.noTLSVerify = true;
    if (h.httpHostHeader) originRequest.httpHostHeader = h.httpHostHeader;

    const newRule: CloudflareIngressRule = {
      service: config.service_target,
      hostname: h.hostname,
      originRequest: Object.keys(originRequest).length > 0 ? originRequest : undefined,
    };

    // Insert before the last rule (catch-all has no hostname)
    const catchAllIdx = ingress.findIndex(r => !r.hostname);
    if (catchAllIdx >= 0) {
      ingress.splice(catchAllIdx, 0, newRule);
    } else {
      ingress.push(newRule);
    }
    modified = true;
    steps.push(`[tunnel] Added ingress rule for ${h.hostname}`);
  }

  // Push updated tunnel config
  if (modified) {
    const putResult = await cfFetch(tunnelPath, creds.apiToken, 'PUT', {
      config: { ingress },
    });
    if (!putResult.ok) {
      steps.push(`[tunnel] Failed to update tunnel config: ${JSON.stringify(putResult.errors)}`);
      allOk = false;
    } else {
      steps.push('[tunnel] Updated tunnel ingress configuration');
    }
  }

  // Create DNS CNAME records
  for (const h of resolved) {
    const dnsResult = await cfFetch(
      `/zones/${creds.zoneId}/dns_records`,
      creds.apiToken,
      'POST',
      {
        type: 'CNAME',
        name: h.hostname,
        content: `${config.tunnel_id}.cfargotunnel.com`,
        proxied: true,
      },
    );
    if (!dnsResult.ok) {
      const errMsg = dnsResult.errors?.map((e: any) => e.message).join(', ') || 'unknown error';
      // Record already exists is not a failure
      if (errMsg.includes('already exists') || errMsg.includes('already been taken')) {
        steps.push(`[tunnel] DNS CNAME for ${h.hostname} already exists`);
      } else {
        steps.push(`[tunnel] Failed to create DNS CNAME for ${h.hostname}: ${errMsg}`);
        allOk = false;
      }
    } else {
      steps.push(`[tunnel] Created DNS CNAME: ${h.hostname} → ${config.tunnel_id}.cfargotunnel.com`);
    }
  }

  return { success: allOk, steps };
}async function removeTunnelIngressPromise(
  config: TunnelConfig,
  placeholders: TemplatePlaceholders,
): Promise<TunnelResult> {
  const steps: string[] = [];
  let allOk = true;

  // Read credentials
  const creds = readCloudflareCredentials(config.credentials_file);
  if (!creds) {
    return { success: false, steps: ['[tunnel] Failed to read Cloudflare credentials from ' + config.credentials_file] };
  }
  steps.push('[tunnel] Read Cloudflare credentials');

  const resolved = resolveHostnames(config.hostnames, placeholders);
  const hostnameSet = new Set(resolved.map(h => h.hostname));

  // Get current tunnel configuration
  const tunnelPath = `/accounts/${creds.accountId}/cfd_tunnel/${config.tunnel_id}/configurations`;
  const current = await cfFetch(tunnelPath, creds.apiToken);
  if (!current.ok) {
    steps.push(`[tunnel] Failed to get tunnel config: ${JSON.stringify(current.errors)}`);
    // Continue to attempt DNS cleanup even if tunnel config read fails
    allOk = false;
  } else {
    const tunnelConfig: CloudflareTunnelConfig = current.data;
    const ingress: CloudflareIngressRule[] = tunnelConfig.config?.ingress || [];
    const originalCount = ingress.length;

    // Filter out matching ingress rules
    const filtered = ingress.filter(r => !r.hostname || !hostnameSet.has(r.hostname));

    if (filtered.length < originalCount) {
      const putResult = await cfFetch(tunnelPath, creds.apiToken, 'PUT', {
        config: { ingress: filtered },
      });
      if (!putResult.ok) {
        steps.push(`[tunnel] Failed to update tunnel config: ${JSON.stringify(putResult.errors)}`);
        allOk = false;
      } else {
        steps.push(`[tunnel] Removed ${originalCount - filtered.length} ingress rule(s)`);
      }
    } else {
      steps.push('[tunnel] No matching ingress rules found to remove');
    }
  }

  // Remove DNS CNAME records
  for (const h of resolved) {
    // Find the DNS record
    const listResult = await cfFetch(
      `/zones/${creds.zoneId}/dns_records?name=${encodeURIComponent(h.hostname)}&type=CNAME`,
      creds.apiToken,
    );
    if (!listResult.ok) {
      steps.push(`[tunnel] Failed to look up DNS record for ${h.hostname}: ${JSON.stringify(listResult.errors)}`);
      allOk = false;
      continue;
    }

    const records = Array.isArray(listResult.data) ? listResult.data : [];
    if (records.length === 0) {
      steps.push(`[tunnel] No DNS CNAME record found for ${h.hostname}`);
      continue;
    }

    for (const record of records) {
      const delResult = await cfFetch(
        `/zones/${creds.zoneId}/dns_records/${record.id}`,
        creds.apiToken,
        'DELETE',
      );
      if (!delResult.ok) {
        steps.push(`[tunnel] Failed to delete DNS record ${record.id} for ${h.hostname}: ${JSON.stringify(delResult.errors)}`);
        allOk = false;
      } else {
        steps.push(`[tunnel] Deleted DNS CNAME for ${h.hostname}`);
      }
    }
  }

  return { success: allOk, steps };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Add tunnel ingress rules and DNS CNAME records for a workspace.
 * Cloudflare API failures are surfaced as TrackerError; the per-step success
 * map is preserved in the success channel via `TunnelResult.steps`.
 */
export const addTunnelIngress = (
  config: TunnelConfig,
  placeholders: TemplatePlaceholders,
): Effect.Effect<TunnelResult, TrackerError> =>
  Effect.tryPromise({
    try: () => addTunnelIngressPromise(config, placeholders),
    catch: (cause) =>
      new TrackerError({
        tracker: 'cloudflare',
        operation: 'addTunnelIngress',
        message: 'addTunnelIngress failed',
        cause,
      }),
  });

/**
 * Remove tunnel ingress rules and DNS CNAME records for a workspace.
 */
export const removeTunnelIngress = (
  config: TunnelConfig,
  placeholders: TemplatePlaceholders,
): Effect.Effect<TunnelResult, TrackerError> =>
  Effect.tryPromise({
    try: () => removeTunnelIngressPromise(config, placeholders),
    catch: (cause) =>
      new TrackerError({
        tracker: 'cloudflare',
        operation: 'removeTunnelIngress',
        message: 'removeTunnelIngress failed',
        cause,
      }),
  });
