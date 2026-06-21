import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDashboardApiUrlSync } from '../config.js';

// Regression lock for the DASHBOARD_URL → 404 bug: internal CLI/host → dashboard
// calls must use the loopback (OVERDECK_DASHBOARD_URL), never a stale public
// Traefik host (e.g. https://pan.localhost) inherited from the dashboard
// process env. https://pan.localhost 404s the API and breaks on the
// pan→overdeck host rename, so the internal var must win.
describe('getDashboardApiUrlSync — env precedence', () => {
  const savedOverdeck = process.env.OVERDECK_DASHBOARD_URL;
  const savedDashboard = process.env.DASHBOARD_URL;

  beforeEach(() => {
    delete process.env.OVERDECK_DASHBOARD_URL;
    delete process.env.DASHBOARD_URL;
  });

  afterEach(() => {
    if (savedOverdeck === undefined) delete process.env.OVERDECK_DASHBOARD_URL;
    else process.env.OVERDECK_DASHBOARD_URL = savedOverdeck;
    if (savedDashboard === undefined) delete process.env.DASHBOARD_URL;
    else process.env.DASHBOARD_URL = savedDashboard;
  });

  it('prefers OVERDECK_DASHBOARD_URL over a stale public DASHBOARD_URL', () => {
    process.env.OVERDECK_DASHBOARD_URL = 'http://127.0.0.1:3011';
    process.env.DASHBOARD_URL = 'https://pan.localhost';
    expect(getDashboardApiUrlSync()).toBe('http://127.0.0.1:3011');
  });

  it('falls back to DASHBOARD_URL when OVERDECK_DASHBOARD_URL is unset', () => {
    process.env.DASHBOARD_URL = 'http://dashboard.test';
    expect(getDashboardApiUrlSync()).toBe('http://dashboard.test');
  });

  it('defaults to a loopback URL when neither var is set', () => {
    expect(getDashboardApiUrlSync()).toMatch(/^http:\/\/localhost:\d+$/);
  });
});
