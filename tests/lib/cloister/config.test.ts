/**
 * Tests for Cloister configuration management
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CLOISTER_CONFIG,
  type CloisterConfig,
  type HealthThresholds,
} from '../../../src/lib/cloister/config.js';

describe('Cloister Configuration', () => {
  describe('DEFAULT_CLOISTER_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_CLOISTER_CONFIG.startup.auto_start).toBe(true);
      expect(DEFAULT_CLOISTER_CONFIG.thresholds.stale).toBe(5);
      expect(DEFAULT_CLOISTER_CONFIG.thresholds.warning).toBe(15);
      expect(DEFAULT_CLOISTER_CONFIG.thresholds.stuck).toBe(30);
      expect(DEFAULT_CLOISTER_CONFIG.auto_actions.poke_on_warning).toBe(true);
      expect(DEFAULT_CLOISTER_CONFIG.auto_actions.kill_on_stuck).toBe(false);
      expect(DEFAULT_CLOISTER_CONFIG.monitoring.check_interval).toBe(60);
    });

    it('should have heartbeat sources configured', () => {
      expect(DEFAULT_CLOISTER_CONFIG.monitoring.heartbeat_sources).toContain('jsonl_mtime');
      expect(DEFAULT_CLOISTER_CONFIG.monitoring.heartbeat_sources).toContain('tmux_activity');
      expect(DEFAULT_CLOISTER_CONFIG.monitoring.heartbeat_sources).toContain('git_activity');
    });

    it('should have proper threshold ordering', () => {
      const thresholds = DEFAULT_CLOISTER_CONFIG.thresholds;
      expect(thresholds.stale).toBeLessThan(thresholds.warning);
      expect(thresholds.warning).toBeLessThan(thresholds.stuck);
    });

    it('should have safe auto_actions defaults', () => {
      // Poke on warning is safe, so it's enabled by default
      expect(DEFAULT_CLOISTER_CONFIG.auto_actions.poke_on_warning).toBe(true);

      // Kill on stuck is dangerous, so it's disabled by default
      expect(DEFAULT_CLOISTER_CONFIG.auto_actions.kill_on_stuck).toBe(false);

      // Restart on kill is disabled by default
      expect(DEFAULT_CLOISTER_CONFIG.auto_actions.restart_on_kill).toBe(false);
    });

    it('should have reasonable monitoring interval', () => {
      const intervalSeconds = DEFAULT_CLOISTER_CONFIG.monitoring.check_interval;

      // Should check at least every 5 minutes
      expect(intervalSeconds).toBeLessThanOrEqual(5 * 60);

      // Should not check more frequently than every 10 seconds
      expect(intervalSeconds).toBeGreaterThanOrEqual(10);
    });

    it('should have specialist agents configured', () => {
      expect(DEFAULT_CLOISTER_CONFIG.specialists).toBeDefined();
      expect(DEFAULT_CLOISTER_CONFIG.specialists?.merge_agent).toBeDefined();
      expect(DEFAULT_CLOISTER_CONFIG.specialists?.review_agent).toBeDefined();
      expect(DEFAULT_CLOISTER_CONFIG.specialists?.test_agent).toBeDefined();
    });

    it('should enable merge and review agents by default', () => {
      expect(DEFAULT_CLOISTER_CONFIG.specialists?.merge_agent?.enabled).toBe(true);
      expect(DEFAULT_CLOISTER_CONFIG.specialists?.merge_agent?.auto_wake).toBe(true);
      expect(DEFAULT_CLOISTER_CONFIG.specialists?.review_agent?.enabled).toBe(true);
      expect(DEFAULT_CLOISTER_CONFIG.specialists?.review_agent?.auto_wake).toBe(true);
    });

    it('should disable test agent by default', () => {
      // Test agent not yet implemented, so disabled
      expect(DEFAULT_CLOISTER_CONFIG.specialists?.test_agent?.enabled).toBe(false);
      expect(DEFAULT_CLOISTER_CONFIG.specialists?.test_agent?.auto_wake).toBe(false);
    });

    it('should have notification placeholders', () => {
      expect(DEFAULT_CLOISTER_CONFIG.notifications).toBeDefined();
      expect(DEFAULT_CLOISTER_CONFIG.notifications?.slack_webhook).toBeUndefined();
      expect(DEFAULT_CLOISTER_CONFIG.notifications?.email).toBeUndefined();
    });
  });

  describe('Configuration Structure', () => {
    it('should have all required top-level sections', () => {
      const config = DEFAULT_CLOISTER_CONFIG;

      expect(config).toHaveProperty('startup');
      expect(config).toHaveProperty('thresholds');
      expect(config).toHaveProperty('auto_actions');
      expect(config).toHaveProperty('monitoring');
      expect(config).toHaveProperty('notifications');
      expect(config).toHaveProperty('specialists');
    });

    it('should have required startup fields', () => {
      const startup = DEFAULT_CLOISTER_CONFIG.startup;

      expect(startup).toHaveProperty('auto_start');
      expect(typeof startup.auto_start).toBe('boolean');
    });

    it('should have required threshold fields', () => {
      const thresholds = DEFAULT_CLOISTER_CONFIG.thresholds;

      expect(thresholds).toHaveProperty('stale');
      expect(thresholds).toHaveProperty('warning');
      expect(thresholds).toHaveProperty('stuck');

      expect(typeof thresholds.stale).toBe('number');
      expect(typeof thresholds.warning).toBe('number');
      expect(typeof thresholds.stuck).toBe('number');
    });

    it('should have required auto_actions fields', () => {
      const autoActions = DEFAULT_CLOISTER_CONFIG.auto_actions;

      expect(autoActions).toHaveProperty('poke_on_warning');
      expect(autoActions).toHaveProperty('kill_on_stuck');
      expect(autoActions).toHaveProperty('restart_on_kill');

      expect(typeof autoActions.poke_on_warning).toBe('boolean');
      expect(typeof autoActions.kill_on_stuck).toBe('boolean');
      expect(typeof autoActions.restart_on_kill).toBe('boolean');
    });

    it('should have required monitoring fields', () => {
      const monitoring = DEFAULT_CLOISTER_CONFIG.monitoring;

      expect(monitoring).toHaveProperty('check_interval');
      expect(monitoring).toHaveProperty('heartbeat_sources');

      expect(typeof monitoring.check_interval).toBe('number');
      expect(Array.isArray(monitoring.heartbeat_sources)).toBe(true);
      expect(monitoring.heartbeat_sources.length).toBeGreaterThan(0);
    });
  });

  describe('Threshold Calculations', () => {
    it('should convert minutes to milliseconds correctly', () => {
      const thresholds: HealthThresholds = {
        stale: 5,
        warning: 15,
        stuck: 30,
      };

      const staleMs = thresholds.stale * 60 * 1000;
      const warningMs = thresholds.warning * 60 * 1000;
      const stuckMs = thresholds.stuck * 60 * 1000;

      expect(staleMs).toBe(5 * 60 * 1000); // 5 minutes
      expect(warningMs).toBe(15 * 60 * 1000); // 15 minutes
      expect(stuckMs).toBe(30 * 60 * 1000); // 30 minutes
    });

    it('should maintain threshold ordering after conversion', () => {
      const thresholds = DEFAULT_CLOISTER_CONFIG.thresholds;

      const staleMs = thresholds.stale * 60 * 1000;
      const warningMs = thresholds.warning * 60 * 1000;
      const stuckMs = thresholds.stuck * 60 * 1000;

      expect(staleMs).toBeLessThan(warningMs);
      expect(warningMs).toBeLessThan(stuckMs);
    });
  });

  describe('Config Validation', () => {
    it('should allow valid custom thresholds', () => {
      const customConfig: CloisterConfig = {
        ...DEFAULT_CLOISTER_CONFIG,
        thresholds: {
          stale: 10,
          warning: 20,
          stuck: 40,
        },
      };

      expect(customConfig.thresholds.stale).toBe(10);
      expect(customConfig.thresholds.warning).toBe(20);
      expect(customConfig.thresholds.stuck).toBe(40);
    });

    it('should allow custom auto_actions', () => {
      const customConfig: CloisterConfig = {
        ...DEFAULT_CLOISTER_CONFIG,
        auto_actions: {
          poke_on_warning: false,
          kill_on_stuck: true,
          restart_on_kill: true,
        },
      };

      expect(customConfig.auto_actions.poke_on_warning).toBe(false);
      expect(customConfig.auto_actions.kill_on_stuck).toBe(true);
      expect(customConfig.auto_actions.restart_on_kill).toBe(true);
    });

    it('should allow custom monitoring interval', () => {
      const customConfig: CloisterConfig = {
        ...DEFAULT_CLOISTER_CONFIG,
        monitoring: {
          ...DEFAULT_CLOISTER_CONFIG.monitoring,
          check_interval: 30,
        },
      };

      expect(customConfig.monitoring.check_interval).toBe(30);
    });
  });
});
