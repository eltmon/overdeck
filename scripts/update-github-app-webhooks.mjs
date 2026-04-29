#!/usr/bin/env node
/**
 * Update existing GitHub App webhook configuration (PAN-905).
 *
 * Reads credentials from ~/.panopticon/github-app/, generates a JWT,
 * creates/reuses a smee.io channel, and updates the app via GitHub API.
 *
 * Usage:
 *   node scripts/update-github-app-webhooks.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createSign } from 'node:crypto';
import SmeeClient from 'smee-client';

const APP_DIR = join(homedir(), '.panopticon', 'github-app');

if (process.env.PANOPTICON_DEV_WEBHOOKS !== '1') {
  console.error('Refusing to configure a third-party webhook relay outside dev mode.');
  console.error('Set PANOPTICON_DEV_WEBHOOKS=1 to enable smee.io for local development.');
  process.exit(1);
}

const WEBHOOK_EVENTS = [
  'check_suite',
  'check_run',
  'pull_request',
  'pull_request_review',
  'pull_request_review_thread',
  'status',
];

function generateJWT(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  })).toString('base64url');

  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey, 'base64url');
  return `${header}.${payload}.${signature}`;
}

async function main() {
  // Read credentials
  const appIdPath = join(APP_DIR, 'app-id');
  const privateKeyPath = join(APP_DIR, 'private-key.pem');
  const appSlugPath = join(APP_DIR, 'app-slug');

  if (!existsSync(appIdPath) || !existsSync(privateKeyPath)) {
    console.error('❌ GitHub App credentials not found.');
    console.error(`   Expected: ${APP_DIR}/{app-id,private-key.pem}`);
    console.error('   Run: node scripts/create-github-app.mjs');
    process.exit(1);
  }

  const appId = readFileSync(appIdPath, 'utf-8').trim();
  const privateKey = readFileSync(privateKeyPath, 'utf-8');
  const appSlug = existsSync(appSlugPath) ? readFileSync(appSlugPath, 'utf-8').trim() : 'panopticon-agent';

  // Create or reuse smee.io channel
  const smeeUrlPath = join(APP_DIR, 'smee-url');
  let smeeUrl;
  if (existsSync(smeeUrlPath)) {
    smeeUrl = readFileSync(smeeUrlPath, 'utf-8').trim();
    console.log(`🔗 Reusing existing smee.io channel: ${smeeUrl}`);
  } else {
    try {
      smeeUrl = await SmeeClient.createChannel();
      console.log(`🔗 Created new smee.io channel: ${smeeUrl}`);
      mkdirSync(APP_DIR, { recursive: true });
      writeFileSync(smeeUrlPath, smeeUrl);
    } catch (err) {
      console.error('❌ Failed to create smee.io channel:', err.message);
      process.exit(1);
    }
  }

  const jwt = generateJWT(appId, privateKey);

  // Verify auth by fetching the app
  console.log('\n🔍 Verifying GitHub App authentication...');
  const appResponse = await fetch('https://api.github.com/app', {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'panopticon-cli',
    },
  });

  if (!appResponse.ok) {
    const text = await appResponse.text();
    console.error(`❌ GitHub API authentication failed: ${appResponse.status} ${text}`);
    process.exit(1);
  }

  const appData = await appResponse.json();
  console.log(`   App: ${appData.name} (ID: ${appData.id})`);
  console.log(`   Current webhook: ${appData.webhook_url || '(none)'} (active: ${appData.webhook_active})`);

  // Update webhook config and events
  console.log('\n📝 Updating webhook configuration...');
  const updateResponse = await fetch('https://api.github.com/app', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'panopticon-cli',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      webhook_active: true,
      webhook_url: smeeUrl,
      events: WEBHOOK_EVENTS,
    }),
  });

  if (!updateResponse.ok) {
    const text = await updateResponse.text();
    console.error(`❌ Failed to update app: ${updateResponse.status} ${text}`);
    process.exit(1);
  }

  const updated = await updateResponse.json();
  console.log('\n✅ GitHub App updated successfully!');
  console.log(`   Webhook:   ${updated.webhook_url} (active: ${updated.webhook_active})`);
  console.log(`   Events:    ${updated.events?.join(', ') || WEBHOOK_EVENTS.join(', ')}`);
  console.log(`   Smee URL:  ${smeeUrl}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
