import { WebSocket } from 'ws';
import { decodeServer, encode, PROTOCOL_VERSION, type ClientMessage } from './protocol.js';
import type { PartnerView, Presence, StatusState } from '../types.js';

/**
 * Reconnecting sync client.
 *
 * Connects to the relay, announces our status, and keeps a live view of the
 * partner. To let both sides detect a frozen/crashed agent, we re-publish our
 * current state on a heartbeat interval; the partner marks us "stale" if these
 * stop arriving, and "offline" if the relay reports we left.
 */

export interface SyncClientOptions {
  url: string;
  room: string;
  peerId: string;
  name: string;
  partnerName: string;
  /** Called whenever the partner's state or presence changes. */
  onPartner: (view: PartnerView) => void;
  /** Called when our own connection to the relay goes up/down. */
  onConnection?: (connected: boolean) => void;
  heartbeatMs?: number;
  staleAfterMs?: number;
  maxBackoffMs?: number;
}

export class SyncClient {
  private ws: WebSocket | null = null;
  private myState: StatusState | null = null;
  private stopped = false;
  private backoff = 1000;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private staleCheck: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPartnerMsgAt = 0;

  private partner: PartnerView;

  private readonly heartbeatMs: number;
  private readonly staleAfterMs: number;
  private readonly maxBackoffMs: number;

  constructor(private readonly opts: SyncClientOptions) {
    this.heartbeatMs = opts.heartbeatMs ?? 20_000;
    this.staleAfterMs = opts.staleAfterMs ?? 45_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.partner = { peerId: null, name: opts.partnerName, presence: 'offline', state: null };
  }

  start(state: StatusState | null): void {
    this.stopped = false;
    this.myState = state;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  /** Publish a new local state (called by the app on any status change). */
  publish(state: StatusState): void {
    this.myState = state;
    this.send({ type: 'state', state });
  }

  getPartner(): PartnerView {
    return this.partner;
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private updatePartner(patch: Partial<PartnerView>): void {
    const next = { ...this.partner, ...patch };
    const changed =
      next.presence !== this.partner.presence ||
      next.peerId !== this.partner.peerId ||
      next.name !== this.partner.name ||
      next.state !== this.partner.state;
    this.partner = next;
    if (changed) this.opts.onPartner(this.partner);
  }

  private setPresence(presence: Presence): void {
    if (this.partner.presence !== presence) this.updatePartner({ presence });
  }

  private connect(): void {
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.on('open', () => {
      this.backoff = 1000;
      this.opts.onConnection?.(true);
      this.send({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        room: this.opts.room,
        peerId: this.opts.peerId,
        name: this.opts.name,
        state: this.myState,
      });
      this.startTimers();
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = decodeServer(data.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case 'peer_state':
          this.lastPartnerMsgAt = Date.now();
          this.updatePartner({
            peerId: msg.peerId,
            name: msg.name || this.opts.partnerName,
            presence: 'online',
            state: msg.state,
          });
          break;
        case 'peer_left':
          if (msg.peerId === this.partner.peerId || this.partner.peerId === null) {
            this.updatePartner({ presence: 'offline' });
          }
          break;
        case 'welcome':
        case 'pong':
        case 'error':
          break;
      }
    });

    const onDown = () => {
      this.clearTimers();
      this.opts.onConnection?.(false);
      // We can no longer vouch for the partner while disconnected.
      this.setPresence('offline');
      this.scheduleReconnect();
    };
    ws.on('close', onDown);
    ws.on('error', onDown);
  }

  private startTimers(): void {
    this.clearTimers();
    this.heartbeat = setInterval(() => {
      if (this.myState) this.send({ type: 'state', state: this.myState });
      this.send({ type: 'ping' });
    }, this.heartbeatMs);
    this.staleCheck = setInterval(() => {
      if (this.partner.presence === 'online' && Date.now() - this.lastPartnerMsgAt > this.staleAfterMs) {
        this.setPresence('stale');
      }
    }, Math.max(1000, Math.floor(this.staleAfterMs / 3)));
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.staleCheck) clearInterval(this.staleCheck);
    this.heartbeat = null;
    this.staleCheck = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) return;
    const delay = this.backoff;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.connect();
    }, delay);
    this.backoff = Math.min(this.maxBackoffMs, this.backoff * 2);
  }
}
