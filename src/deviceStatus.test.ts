import { describe, it, expect } from 'vitest';
import {
  parseSnapshot,
  themeToStatus,
  buildStateFromDevice,
  deviceStatusKey,
  DeviceStatusWatcher,
} from './deviceStatus.js';

// Real payloads captured from a device.
const IDLE = {
  snapshot: { type: 'NOT_STARTED', busy_bar_settings: { theme: 'on_call', show_work_phase_only: true } },
  snapshot_timestamp_ms: 1784758441699,
};
const RUNNING = {
  snapshot: {
    type: 'INTERVAL',
    card_id: '00000000-0000-0000-0000-000000000001',
    is_paused: false,
    current_interval: 0,
    current_interval_time_total_ms: 1500000,
    current_interval_time_left_ms: 1500000,
    busy_bar_settings: { theme: 'on_call' },
  },
  snapshot_timestamp_ms: 1784764341722,
};

describe('parseSnapshot', () => {
  it('reads the theme and idle state', () => {
    expect(parseSnapshot(IDLE)).toEqual({ theme: 'on_call', sessionActive: false, paused: false, timeLeftMs: null });
  });

  it('reads a running interval session with time left', () => {
    expect(parseSnapshot(RUNNING)).toEqual({
      theme: 'on_call',
      sessionActive: true,
      paused: false,
      timeLeftMs: 1500000,
    });
  });

  it('defaults gracefully on empty input', () => {
    expect(parseSnapshot({}).theme).toBe('available');
    expect(parseSnapshot(null).sessionActive).toBe(false);
  });
});

describe('themeToStatus', () => {
  it('maps known themes', () => {
    expect(themeToStatus('on_call')).toMatchObject({ label: 'On a call', alert: true });
    expect(themeToStatus('focus')).toMatchObject({ label: 'Focus' });
  });

  it('humanizes unknown themes', () => {
    expect(themeToStatus('movie_night')).toMatchObject({ id: 'movie_night', label: 'Movie Night' });
  });

  it('applies config overrides', () => {
    const s = themeToStatus('on_call', [{ id: 'on_call', label: 'Recording', color: '#DC2626FF', alert: true }]);
    expect(s.label).toBe('Recording');
  });
});

describe('buildStateFromDevice', () => {
  it('has no timer when idle', () => {
    const s = buildStateFromDevice(parseSnapshot(IDLE), 1_000_000);
    expect(s.label).toBe('On a call');
    expect(s.alert).toBe(true);
    expect(s.timer).toBeNull();
  });

  it('attaches a countdown timer when a session runs', () => {
    const now = 1_000_000;
    const s = buildStateFromDevice(parseSnapshot(RUNNING), now);
    expect(s.timer).not.toBeNull();
    expect(s.timer!.paused).toBe(false);
    expect(s.timer!.endsAt).toBe(Math.round((now + 1500000) / 1000));
  });
});

describe('deviceStatusKey', () => {
  it('is stable across ticking time but changes on transitions', () => {
    const a = parseSnapshot(RUNNING);
    const b = { ...a, timeLeftMs: 1400000 }; // clock ticked
    expect(deviceStatusKey(a)).toBe(deviceStatusKey(b));
    const paused = { ...a, paused: true };
    expect(deviceStatusKey(a)).not.toBe(deviceStatusKey(paused));
  });
});

describe('DeviceStatusWatcher', () => {
  it('fires onChange only on meaningful transitions', async () => {
    let current: unknown = IDLE;
    const source = { get: async () => current };
    const seen: string[] = [];
    const w = new DeviceStatusWatcher(source, (s) => seen.push(s.theme + (s.sessionActive ? ':on' : ':off')));

    await w.poll(); // idle
    await w.poll(); // still idle -> no new event
    current = RUNNING;
    await w.poll(); // now running
    await w.poll(); // still running -> no new event

    expect(seen).toEqual(['on_call:off', 'on_call:on']);
  });

  it('swallows poll errors via onError', async () => {
    const source = {
      get: async () => {
        throw new Error('unreachable');
      },
    };
    let errMsg = '';
    const w = new DeviceStatusWatcher(source, () => {}, { onError: (e) => (errMsg = e.message) });
    await w.poll();
    expect(errMsg).toBe('unreachable');
  });
});
