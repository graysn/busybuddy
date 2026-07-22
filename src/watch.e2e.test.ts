import { describe, it, expect, afterEach } from 'vitest';
import { EmulatorServer } from './emulator/server.js';
import { SyncServer } from './sync/server.js';
import { App } from './app.js';
import { DeviceBar } from './bar.js';
import { parseConfig } from './config.js';
import type { PartnerView } from './types.js';
import { SyncClient } from './sync/client.js';

const snapshot = (theme: string, running: boolean) => ({
  snapshot: running
    ? { type: 'INTERVAL', is_paused: false, current_interval_time_left_ms: 1500000, busy_bar_settings: { theme } }
    : { type: 'NOT_STARTED', busy_bar_settings: { theme } },
  snapshot_timestamp_ms: 0,
});

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('watch mode end-to-end', () => {
  let emu: EmulatorServer;
  let relay: SyncServer;
  let app: App;
  let observer: SyncClient;

  afterEach(async () => {
    observer?.stop();
    await app?.stop();
    await relay?.stop();
    await emu?.stop();
  });

  it('mirrors the on-device theme + session to the partner', async () => {
    emu = new EmulatorServer({ port: 0, host: '127.0.0.1', label: 'Bar' });
    const { url } = await emu.start();
    emu.setBusySnapshot(snapshot('on_call', false));

    relay = new SyncServer({ port: 0, host: '127.0.0.1' });
    const { port } = await relay.start();
    const syncUrl = `ws://127.0.0.1:${port}`;

    const cfg = parseConfig({
      name: 'Grayson',
      partnerName: 'Erik',
      bar: { addr: url, watch: true, watchIntervalMs: 40 },
      sync: { url: syncUrl, room: 'watch' },
    });
    app = new App(cfg, new DeviceBar(cfg.bar), () => {});

    // A second client in the same room stands in for the partner, observing.
    let partner: PartnerView | null = null;
    observer = new SyncClient({
      url: syncUrl,
      room: 'watch',
      peerId: 'observer',
      name: 'Erik',
      partnerName: 'Grayson',
      heartbeatMs: 10_000,
      staleAfterMs: 10_000,
      onPartner: (v) => (partner = v),
    });
    observer.start(null);
    await app.start();

    // The bar's selected theme (on_call) should reach the partner.
    await waitFor(() => partner?.state?.label === 'On a call');
    expect(partner!.state!.timer).toBeNull();

    // Start a session on the device → partner should see the running timer.
    emu.setBusySnapshot(snapshot('on_call', true));
    await waitFor(() => partner?.state?.timer != null);
    expect(partner!.state!.timer!.paused).toBe(false);

    // Change the on-device status → partner follows.
    emu.setBusySnapshot(snapshot('focus', true));
    await waitFor(() => partner?.state?.label === 'Focus');
  });
});
