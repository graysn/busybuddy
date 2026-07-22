import { describe, it, expect, afterEach } from 'vitest';
import { SyncServer } from './server.js';
import { SyncClient } from './client.js';
import type { PartnerView, StatusState } from '../types.js';

const st = (label: string, color = '#FFFFFFFF'): StatusState => ({
  statusId: label.toLowerCase(),
  label,
  color,
  alert: false,
  timer: null,
  updatedAt: Date.now(),
});

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('sync server + client integration', () => {
  let server: SyncServer;
  const clients: SyncClient[] = [];

  afterEach(async () => {
    for (const c of clients) c.stop();
    clients.length = 0;
    await server?.stop();
  });

  it('propagates status between two paired agents', async () => {
    server = new SyncServer({ port: 0, host: '127.0.0.1' });
    const { port } = await server.start();
    const url = `ws://127.0.0.1:${port}`;

    let aSeesPartner: PartnerView | null = null;
    let bSeesPartner: PartnerView | null = null;

    const a = new SyncClient({
      url,
      room: 'house',
      peerId: 'A',
      name: 'Alice',
      partnerName: 'Bob',
      heartbeatMs: 10_000,
      staleAfterMs: 10_000,
      onPartner: (v) => (aSeesPartner = v),
    });
    const b = new SyncClient({
      url,
      room: 'house',
      peerId: 'B',
      name: 'Bob',
      partnerName: 'Alice',
      heartbeatMs: 10_000,
      staleAfterMs: 10_000,
      onPartner: (v) => (bSeesPartner = v),
    });
    clients.push(a, b);

    a.start(st('Available'));
    b.start(st('In a meeting', '#F59E0BFF'));

    // Each should learn about the other.
    await waitFor(() => aSeesPartner?.state?.label === 'In a meeting');
    await waitFor(() => bSeesPartner?.state?.label === 'Available');
    expect(aSeesPartner!.presence).toBe('online');
    expect(aSeesPartner!.name).toBe('Bob');

    // A live status change on B reaches A.
    b.publish(st('Recording', '#DC2626FF'));
    await waitFor(() => aSeesPartner?.state?.label === 'Recording');
    expect(aSeesPartner!.state!.color).toBe('#DC2626FF');
  });

  it('marks the partner offline when they disconnect', async () => {
    server = new SyncServer({ port: 0, host: '127.0.0.1' });
    const { port } = await server.start();
    const url = `ws://127.0.0.1:${port}`;

    let aSees: PartnerView | null = null;
    const a = new SyncClient({
      url,
      room: 'house',
      peerId: 'A',
      name: 'Alice',
      partnerName: 'Bob',
      heartbeatMs: 10_000,
      staleAfterMs: 10_000,
      onPartner: (v) => (aSees = v),
    });
    const b = new SyncClient({
      url,
      room: 'house',
      peerId: 'B',
      name: 'Bob',
      partnerName: 'Alice',
      heartbeatMs: 10_000,
      staleAfterMs: 10_000,
      onPartner: () => {},
    });
    clients.push(a, b);

    a.start(st('Available'));
    b.start(st('Available'));
    await waitFor(() => aSees?.presence === 'online');

    b.stop();
    await waitFor(() => aSees?.presence === 'offline');
  });
});
