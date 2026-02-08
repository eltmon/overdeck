/**
 * Traefik Configuration Generator
 *
 * Generates the Panopticon dashboard Traefik routing config
 * from a template, substituting values from config.toml.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { TRAEFIK_DYNAMIC_DIR, SOURCE_TRAEFIK_TEMPLATES } from './paths.js';
import { loadConfig } from './config.js';

/**
 * Generate panopticon.yml from template using current config values.
 * Safe to call multiple times (idempotent).
 * Returns true if file was written, false if template not found.
 */
export function generatePanopticonTraefikConfig(): boolean {
  const templatePath = join(SOURCE_TRAEFIK_TEMPLATES, 'dynamic', 'panopticon.yml.template');
  if (!existsSync(templatePath)) {
    return false;
  }

  const config = loadConfig();
  const placeholders: Record<string, string> = {
    TRAEFIK_DOMAIN: config.traefik?.domain || 'pan.localhost',
    DASHBOARD_PORT: String(config.dashboard.port),
    DASHBOARD_API_PORT: String(config.dashboard.api_port),
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
export function cleanupTemplateFiles(): void {
  const copiedTemplate = join(TRAEFIK_DYNAMIC_DIR, 'panopticon.yml.template');
  if (existsSync(copiedTemplate)) {
    unlinkSync(copiedTemplate);
  }
}
