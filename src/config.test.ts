import { describe, it, expect, afterEach } from 'vitest';
import { parseConfig } from './config.js';

const ENV_KEYS = ['BUSYBUDDY_BAR_ADDR', 'BUSYBUDDY_BAR_TOKEN', 'BUSYBUDDY_SYNC_URL', 'BUSYBUDDY_ROOM'];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('config', () => {
  it('applies defaults over a minimal config', () => {
    const cfg = parseConfig({ sync: { room: 'abc' } });
    expect(cfg.name).toBe('Me');
    expect(cfg.bar.addr).toBe('10.0.4.20');
    expect(cfg.bar.priority).toBe(60);
    expect(cfg.pomodoro.focusMin).toBe(25);
    expect(cfg.sync.url).toBe('ws://127.0.0.1:8787');
    expect(cfg.sync.room).toBe('abc');
  });

  it('requires a sync room', () => {
    expect(() => parseConfig({})).toThrow();
  });

  it('overrides connection/secrets from environment', () => {
    process.env.BUSYBUDDY_BAR_ADDR = '192.168.1.9';
    process.env.BUSYBUDDY_BAR_TOKEN = 'secret';
    process.env.BUSYBUDDY_SYNC_URL = 'ws://relay.example:9000';
    process.env.BUSYBUDDY_ROOM = 'from-env';
    const cfg = parseConfig({ sync: { room: 'file-room' } });
    expect(cfg.bar.addr).toBe('192.168.1.9');
    expect(cfg.bar.token).toBe('secret');
    expect(cfg.sync.url).toBe('ws://relay.example:9000');
    expect(cfg.sync.room).toBe('from-env');
  });

  it('validates color format in custom statuses', () => {
    expect(() =>
      parseConfig({ sync: { room: 'r' }, customStatuses: [{ id: 'x', label: 'X', color: 'red' }] }),
    ).toThrow();
  });
});
