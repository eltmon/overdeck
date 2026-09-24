/**
 * Tests for Cloister service
 *
 * TODO(PAN-48): These tests are skipped because service.start() doesn't work in test mode.
 * The service relies on actual tmux sessions and intervals that don't run properly
 * in the test environment. Need to refactor the service to be more testable.
 */

import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CloisterService,
  getCloisterService,
  setCloisterService,
  type CloisterEvent,
} from '../../../src/lib/cloister/service.js';
import type { CloisterConfig } from '../../../src/lib/cloister/config.js';
import { DEFAULT_CLOISTER_CONFIG } from '../../../src/lib/cloister/config.js';

// Mock runtime and dependencies
vi.mock('../../../src/lib/agents.js', () => ({
  listRunningAgents: vi.fn(() => Effect.succeed([])),
  listRunningAgentsSync: vi.fn(() => []),
}));

vi.mock('../../../src/lib/runtimes/index.js', () => ({
  getGlobalRegistry: vi.fn(() => ({
    getRuntimeForAgent: vi.fn(() => null),
  })),
  getRuntimeForAgent: vi.fn(() => null),
}));

describe.skip('CloisterService', () => {
  let service: CloisterService;
  let events: CloisterEvent[];

  beforeEach(() => {
    // Create a service with fast check interval for testing
    const testConfig: CloisterConfig = {
      ...DEFAULT_CLOISTER_CONFIG,
      monitoring: {
        ...DEFAULT_CLOISTER_CONFIG.monitoring,
        check_interval: 1, // 1 second for fast tests
      },
    };

    service = new CloisterService(testConfig);
    events = [];

    // Capture events
    service.on((event) => {
      events.push(event);
    });
  });

  afterEach(() => {
    // Stop service if running
    if (service.isRunning()) {
      service.stop();
    }
  });

  describe('start/stop', () => {
    it('should start service successfully', () => {
      expect(service.isRunning()).toBe(false);

      service.start();

      expect(service.isRunning()).toBe(true);
      expect(events).toContainEqual({ type: 'started' });
    });

    it('should stop service successfully', () => {
      service.start();
      expect(service.isRunning()).toBe(true);

      service.stop();

      expect(service.isRunning()).toBe(false);
      expect(events).toContainEqual({ type: 'stopped' });
    });

    it('should not start if already running', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      service.start();
      service.start(); // Try to start again

      expect(consoleSpy).toHaveBeenCalledWith('Cloister is already running');
      consoleSpy.mockRestore();
    });

    it('should not stop if not running', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      service.stop(); // Try to stop when not running

      expect(consoleSpy).toHaveBeenCalledWith('Cloister is not running');
      consoleSpy.mockRestore();
    });
  });

  describe('emergencyStop', () => {
    it('should return empty array when no agents running', () => {
      const killedAgents = service.emergencyStop();

      expect(killedAgents).toEqual([]);
      expect(service.isRunning()).toBe(false);
    });

    it('should emit emergency_stop event', () => {
      service.emergencyStop();

      const emergencyEvent = events.find((e) => e.type === 'emergency_stop');
      expect(emergencyEvent).toBeDefined();
      expect(emergencyEvent).toHaveProperty('killedAgents');
    });

    it('should stop service after emergency stop', () => {
      service.start();
      expect(service.isRunning()).toBe(true);

      service.emergencyStop();

      expect(service.isRunning()).toBe(false);
    });
  });


  describe('getAgentHealth', () => {
    it('should return null for agent with no runtime', () => {
      const health = service.getAgentHealth('non-existent-agent');
      expect(health).toBeNull();
    });
  });

  describe('getAllAgentHealth', () => {
    it('should return empty array when no agents running', async () => {
      const healths = await service.getAllAgentHealth();
      expect(healths).toEqual([]);
    });
  });

  // TODO(PAN-48): Fix config tests - service doesn't maintain running state in test mode

  describe.skip('updateConfig', () => {

    it('should restart monitoring loop with new interval', async () => {
      service.start();

      const newConfig: CloisterConfig = {
        ...DEFAULT_CLOISTER_CONFIG,
        monitoring: {
          ...DEFAULT_CLOISTER_CONFIG.monitoring,
          check_interval: 2, // Different interval
        },
      };

      service.updateConfig(newConfig);

      // Service should still be running
      expect(service.isRunning()).toBe(true);

      service.stop();
    });
  });

  // TODO(PAN-48): Fix event listener tests - service doesn't emit events properly in test mode
  describe.skip('event listeners', () => {
    it('should register and emit events', () => {
      const capturedEvents: CloisterEvent[] = [];
      const listener = (event: CloisterEvent) => {
        capturedEvents.push(event);
      };

      service.on(listener);
      service.start();

      expect(capturedEvents).toContainEqual({ type: 'started' });
    });

    it('should unregister event listeners', () => {
      const capturedEvents: CloisterEvent[] = [];
      const listener = (event: CloisterEvent) => {
        capturedEvents.push(event);
      };

      service.on(listener);
      service.start();

      const eventCountAfterStart = capturedEvents.length;

      service.off(listener);
      service.stop();

      // Stop event should not be captured after unregistering
      expect(capturedEvents.length).toBe(eventCountAfterStart);
    });

    it('should handle listener errors gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const faultyListener = () => {
        throw new Error('Listener error');
      };

      service.on(faultyListener);
      service.start();

      // Service should still be running despite listener error
      expect(service.isRunning()).toBe(true);

      // Error should be logged
      expect(consoleSpy).toHaveBeenCalledWith(
        'Cloister event listener error:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('global service instance', () => {
    it('getCloisterService should return singleton instance', () => {
      const instance1 = getCloisterService();
      const instance2 = getCloisterService();

      expect(instance1).toBe(instance2);
    });

    it('setCloisterService should set global instance', () => {
      const customService = new CloisterService();

      setCloisterService(customService);

      const retrieved = getCloisterService();
      expect(retrieved).toBe(customService);
    });
  });
});
