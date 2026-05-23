/**
 * Traefik Configuration Generator
 *
 * Generates the Panopticon dashboard Traefik routing config
 * from a template, substituting values from config.toml.
 * Also generates TLS certificate configuration from discovered certs.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import { Effect } from 'effect';
import { TRAEFIK_DYNAMIC_DIR, TRAEFIK_CERTS_DIR, TRAEFIK_DIR, SYNC_SOURCES } from './paths.js';
import { loadConfigSync } from './config.js';
import { loadProjectsConfigSync } from './projects.js';
import { FsError } from './errors.js';

/**
/**
 * Render mode for the Traefik config.
 * - 'production': frontend and API both routed to the bundled Node server on
 *   the API port (the bundled dashboard serves static React assets too).
 * - 'dev': frontend routed to Vite (DASHBOARD_PORT) for HMR; API stays on
 *   DASHBOARD_API_PORT. The Vite dev server proxies /api and /ws to the Node
 *   server, but Traefik routes those paths directly to the API to avoid the
 *   extra proxy hop.
 */
export type TraefikRenderMode = 'production' | 'dev';

/**
 * Resolve render mode. Explicit param wins; otherwise the PANOPTICON_DEV env
 * var (truthy = 'dev'); otherwise default to 'production'. This keeps `pan up`
 * unchanged for the common case while letting dev workflows opt in by exporting
 * the env var before invoking any code path that regenerates Traefik config.
 */
export function resolveTraefikRenderMode(explicit?: TraefikRenderMode): TraefikRenderMode {
  if (explicit) return explicit;
  const env = process.env['PANOPTICON_DEV'];
  if (env && env !== '0' && env.toLowerCase() !== 'false') return 'dev';
  return 'production';
}

/**
 * Generate panopticon.yml from template using current config values.
 * Safe to call multiple times (idempotent).
 * Returns true if file was written, false if template not found.
 *
 * Pass `mode: 'dev'` to route the frontend to the Vite dev server (DASHBOARD_PORT).
 * Otherwise the frontend route points to the bundled Node server on the API port,
 * which is the production layout. See template header for the full rationale.
 */
export function generatePanopticonTraefikConfigSync(mode?: TraefikRenderMode): boolean {
  const templatePath = join(SYNC_SOURCES.traefikTemplates, 'dynamic', 'panopticon.yml.template');
  if (!existsSync(templatePath)) {
    return false;
  }

  const config = loadConfigSync();
  const resolvedMode = resolveTraefikRenderMode(mode);
  const frontendPort = resolvedMode === 'dev'
    ? config.dashboard.port
    : config.dashboard.api_port;

  const placeholders: Record<string, string> = {
    TRAEFIK_DOMAIN: config.traefik?.domain || 'pan.localhost',
    DASHBOARD_PORT: String(config.dashboard.port),
    DASHBOARD_API_PORT: String(config.dashboard.api_port),
    DASHBOARD_FRONTEND_PORT: String(frontendPort),
  };

  let content = readFileSync(templatePath, 'utf-8');
  for (const [key, value] of Object.entries(placeholders)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  mkdirSync(TRAEFIK_DYNAMIC_DIR, { recursive: true });
  const outputPath = join(TRAEFIK_DYNAMIC_DIR, 'panopticon.yml');
  writeFileSync(outputPath, content, 'utf-8');
  return true;
}

/**
 * Remove any accidentally-copied .template files from the runtime Traefik dir.
 * Called after copyDirectoryRecursive in pan install.
 */
export function cleanupTemplateFilesSync(): void {
  const copiedTemplate = join(TRAEFIK_DYNAMIC_DIR, 'panopticon.yml.template');
  if (existsSync(copiedTemplate)) {
    unlinkSync(copiedTemplate);
  }
}

/**
 * Generate tls.yml from all discovered certificate files in the certs directory.
 *
 * Traefik v3 ignores `tls:` sections when they appear in the same dynamic config
 * file as `http:` routers/services. This function creates a dedicated tls.yml file
 * that Traefik's file provider will pick up separately.
 *
 * The first cert found (pan.localhost) is used as the default certificate.
 * All certs are listed in the certificates array for SNI matching.
 *
 * Safe to call multiple times (idempotent).
 * Returns true if file was written, false if no certs found.
 */
export function generateTlsConfigSync(): boolean {
  if (!existsSync(TRAEFIK_CERTS_DIR)) {
    return false;
  }

  // Scan for cert files (exclude -key.pem files)
  const files = readdirSync(TRAEFIK_CERTS_DIR);
  const certFiles = files.filter(f => f.endsWith('.pem') && !f.endsWith('-key.pem'));

  if (certFiles.length === 0) {
    return false;
  }

  // Pair each cert with its key file
  const certPairs: Array<{ certFile: string; keyFile: string }> = [];
  for (const certFile of certFiles) {
    const keyFile = certFile.replace('.pem', '-key.pem');
    if (files.includes(keyFile)) {
      certPairs.push({
        certFile: `/etc/traefik/certs/${certFile}`,
        keyFile: `/etc/traefik/certs/${keyFile}`,
      });
    }
  }

  if (certPairs.length === 0) {
    return false;
  }

  // Use the pan.localhost cert as default, fall back to first cert
  const defaultCert = certPairs.find(p => p.certFile.includes('pan.localhost')) || certPairs[0];

  // Build YAML content
  let yaml = '# Auto-generated TLS configuration — do not edit manually\n';
  yaml += '# Generated by: pan up / pan install\n';
  yaml += '# Traefik v3 requires TLS config in a separate dynamic config file\n\n';
  yaml += 'tls:\n';
  yaml += '  stores:\n';
  yaml += '    default:\n';
  yaml += '      defaultCertificate:\n';
  yaml += `        certFile: ${defaultCert.certFile}\n`;
  yaml += `        keyFile: ${defaultCert.keyFile}\n`;
  yaml += '  certificates:\n';
  for (const pair of certPairs) {
    yaml += `    - certFile: ${pair.certFile}\n`;
    yaml += `      keyFile: ${pair.keyFile}\n`;
  }

  mkdirSync(TRAEFIK_DYNAMIC_DIR, { recursive: true });
  const outputPath = join(TRAEFIK_DYNAMIC_DIR, 'tls.yml');
  writeFileSync(outputPath, yaml, 'utf-8');
  return true;
}

/**
 * Ensure wildcard certificates exist for all registered projects that have DNS domains.
 *
 * Scans projects.yaml for projects with workspace.dns.domain, and generates
 * mkcert wildcard certs for any that don't already have certs in the Traefik
 * certs directory.
 *
 * Returns array of domains that had certs generated.
 */
export function ensureProjectCertsSync(): string[] {
  // Check mkcert is available
  try {
    execSync('which mkcert', { stdio: 'pipe' });
  } catch {
    return [];
  }

  const projectsConfig = loadProjectsConfigSync();
  const generated: string[] = [];

  for (const [, project] of Object.entries(projectsConfig.projects)) {
    const domain = project.workspace?.dns?.domain;
    if (!domain) continue;

    const certFile = join(TRAEFIK_CERTS_DIR, `_wildcard.${domain}.pem`);
    const keyFile = join(TRAEFIK_CERTS_DIR, `_wildcard.${domain}-key.pem`);

    if (existsSync(certFile) && existsSync(keyFile)) {
      continue;
    }

    // Generate cert for this project's domain
    mkdirSync(TRAEFIK_CERTS_DIR, { recursive: true });
    try {
      execSync(
        `mkcert -cert-file "${certFile}" -key-file "${keyFile}" "${domain}" "*.${domain}" 2>/dev/null`,
        { stdio: 'pipe' }
      );
      generated.push(domain);
    } catch {
      // mkcert failed — skip this domain
    }
  }

  return generated;
}

/**
 * Remove stale `tls:` sections from runtime config files.
 *
 * Traefik v3 ignores tls: in static config (traefik.yml) and in dynamic
 * config files that also contain http: routers. This function strips those
 * dead sections to avoid confusion.
 *
 * Called during `pan up` to clean up configs from older Panopticon versions.
 */
export function cleanupStaleTlsSectionsSync(): void {
  // Clean static config (traefik.yml)
  const staticConfig = join(TRAEFIK_DIR, 'traefik.yml');
  if (existsSync(staticConfig)) {
    const content = readFileSync(staticConfig, 'utf-8');
    // Remove tls: section at the end of the file
    const cleaned = content.replace(/\n# TLS Configuration\ntls:\n(?:  .*\n)*/g, '\n');
    if (cleaned !== content) {
      writeFileSync(staticConfig, cleaned, 'utf-8');
    }
  }

  // Clean dynamic panopticon.yml (regenerated from template, but also clean runtime copy)
  const dynamicConfig = join(TRAEFIK_DYNAMIC_DIR, 'panopticon.yml');
  if (existsSync(dynamicConfig)) {
    const content = readFileSync(dynamicConfig, 'utf-8');
    // Remove standalone tls: section (not nested under http: routers)
    const cleaned = content.replace(/\ntls:\n  (?:stores|certificates):\n(?:    .*\n)*/g, '\n');
    if (cleaned !== content) {
      writeFileSync(dynamicConfig, cleaned, 'utf-8');
    }
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Render the dashboard Traefik config from the template. */
export const generatePanopticonTraefikConfig = (
  mode?: TraefikRenderMode,
): Effect.Effect<boolean, FsError> =>
  Effect.try({
    try: () => generatePanopticonTraefikConfigSync(mode),
    catch: (cause) =>
      new FsError({
        path: TRAEFIK_DYNAMIC_DIR,
        operation: 'generatePanopticonTraefikConfig',
        cause,
      }),
  });

/** Strip stray .template files from the runtime dynamic dir. */
export const cleanupTemplateFiles = (): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => cleanupTemplateFilesSync(),
    catch: (cause) =>
      new FsError({
        path: TRAEFIK_DYNAMIC_DIR,
        operation: 'cleanupTemplateFiles',
        cause,
      }),
  });

/** Generate the TLS dynamic config file from discovered certs. */
export const generateTlsConfig = (): Effect.Effect<boolean, FsError> =>
  Effect.try({
    try: () => generateTlsConfigSync(),
    catch: (cause) =>
      new FsError({
        path: TRAEFIK_DYNAMIC_DIR,
        operation: 'generateTlsConfig',
        cause,
      }),
  });

/** Ensure wildcard mkcert certs exist for every project's domain. */
export const ensureProjectCerts = (): Effect.Effect<readonly string[], FsError> =>
  Effect.try({
    try: () => ensureProjectCertsSync(),
    catch: (cause) =>
      new FsError({
        path: TRAEFIK_CERTS_DIR,
        operation: 'ensureProjectCerts',
        cause,
      }),
  });

/** Strip stale tls: sections from legacy runtime configs. */
export const cleanupStaleTlsSections = (): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => cleanupStaleTlsSectionsSync(),
    catch: (cause) =>
      new FsError({
        path: TRAEFIK_DIR,
        operation: 'cleanupStaleTlsSections',
        cause,
      }),
  });
