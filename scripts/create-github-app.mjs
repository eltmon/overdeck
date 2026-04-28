#!/usr/bin/env node
/**
 * GitHub App creation helper — uses the manifest flow (PAN-905).
 *
 * 1. Creates a smee.io channel for webhook relay
 * 2. Starts a local server on port 3456
 * 3. Opens browser to GitHub with the app manifest (includes webhook events + smee URL)
 * 4. GitHub redirects back with a code
 * 5. Exchanges code for app credentials (ID, private key, webhook secret)
 * 6. Saves credentials and smee URL to ~/.panopticon/github-app/
 */

import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import SmeeClient from 'smee-client';

const PORT = 3456;
const CALLBACK_URL = `http://localhost:${PORT}/callback`;
const APP_DIR = join(homedir(), '.panopticon', 'github-app');

const WEBHOOK_EVENTS = [
  'check_suite',
  'check_run',
  'pull_request',
  'pull_request_review',
  'pull_request_review_thread',
  'status',
];

async function main() {
  // Create smee.io channel for webhook relay
  let smeeUrl;
  try {
    smeeUrl = await SmeeClient.createChannel();
    console.log(`\n🔗 Created smee.io channel: ${smeeUrl}`);
    mkdirSync(APP_DIR, { recursive: true });
    writeFileSync(join(APP_DIR, 'smee-url'), smeeUrl);
  } catch (err) {
    console.warn('\n⚠ Failed to create smee.io channel:', err.message);
    console.warn('  You can set up webhooks manually later.');
    smeeUrl = 'https://example.com/hook';
  }

  const manifest = {
    name: 'panopticon-agent',
    url: 'https://github.com/eltmon/panopticon-cli',
    hook_attributes: { url: smeeUrl, active: true },
    redirect_url: CALLBACK_URL,
    callback_urls: [CALLBACK_URL],
    public: false,
    default_permissions: {
      contents: 'write',
      pull_requests: 'write',
      metadata: 'read',
      checks: 'write',
      statuses: 'write',
    },
    default_events: WEBHOOK_EVENTS,
  };

  const html = `
<!DOCTYPE html>
<html>
<body>
<h2>Create Panopticon GitHub App</h2>
<p>Click the button to create the <code>panopticon-agent</code> GitHub App on your account.</p>
<form action="https://github.com/settings/apps/new" method="post">
  <input type="hidden" name="manifest" value='${JSON.stringify(manifest)}'>
  <button type="submit" style="font-size:18px;padding:12px 24px;cursor:pointer;background:#238636;color:white;border:none;border-radius:6px;">
    Create panopticon-agent App on GitHub
  </button>
</form>
</body>
</html>`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing code parameter');
        return;
      }

      try {
        // Exchange code for app credentials
        const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
          method: 'POST',
          headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'panopticon-cli',
          },
        });

        if (!response.ok) {
          const text = await response.text();
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`GitHub API error ${response.status}: ${text}`);
          return;
        }

        const data = await response.json();

        // Save credentials
        mkdirSync(APP_DIR, { recursive: true });
        writeFileSync(join(APP_DIR, 'app-id'), String(data.id));
        writeFileSync(join(APP_DIR, 'private-key.pem'), data.pem, { mode: 0o600 });
        if (!data.webhook_secret) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('GitHub did not return a webhook secret. App creation aborted.');
          return;
        }
        writeFileSync(join(APP_DIR, 'webhook-secret'), data.webhook_secret, { mode: 0o600 });
        writeFileSync(join(APP_DIR, 'client-id'), data.client_id || '');
        writeFileSync(join(APP_DIR, 'client-secret'), data.client_secret || '', { mode: 0o600 });
        writeFileSync(join(APP_DIR, 'app-slug'), data.slug || 'panopticon-agent');
        writeFileSync(join(APP_DIR, 'owner'), data.owner?.login || '');

        console.log('\n✅ GitHub App created successfully!');
        console.log(`   App ID:    ${data.id}`);
        console.log(`   App slug:  ${data.slug}`);
        console.log(`   Owner:     ${data.owner?.login}`);
        console.log(`   Webhook:   ${smeeUrl}`);
        console.log(`   Events:    ${WEBHOOK_EVENTS.join(', ')}`);
        console.log(`   Saved to:  ${APP_DIR}/`);
        console.log('\nNext step: Install the app on your repos at:');
        console.log(`   ${data.html_url}/installations/new`);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <h2>✅ panopticon-agent App Created!</h2>
          <p><strong>App ID:</strong> ${data.id}</p>
          <p><strong>Slug:</strong> ${data.slug}</p>
          <p>Webhook events: <code>${WEBHOOK_EVENTS.join(', ')}</code></p>
          <p>Credentials saved to <code>${APP_DIR}/</code></p>
          <h3>Next: Install the app on your repos</h3>
          <p><a href="${data.html_url}/installations/new" style="font-size:16px;">
            → Install panopticon-agent on eltmon/panopticon-cli
          </a></p>
          <p>You can close this tab after installing.</p>
        `);

        // Shut down server after a delay
        setTimeout(() => { server.close(); process.exit(0); }, 5000);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error: ${err.message}`);
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(`\n🔧 GitHub App creation server running at http://localhost:${PORT}`);
    console.log('   Open this URL in your browser to create the app.\n');

    // Try to open browser
    try {
      execSync(`xdg-open http://localhost:${PORT} 2>/dev/null || open http://localhost:${PORT} 2>/dev/null`, { stdio: 'ignore' });
    } catch {}
  });
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
