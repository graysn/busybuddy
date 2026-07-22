import type { Config } from './config.js';
import type { BarDisplay } from './bar.js';
import type { PartnerView, StatusState } from './types.js';
import { StatusCatalog } from './statuses.js';
import { Pomodoro, phaseLabel, type PomodoroSnapshot } from './pomodoro.js';
import { SyncClient } from './sync/client.js';
import { composeFrame } from './render.js';

export interface AppSnapshot {
  me: { name: string; state: StatusState };
  partner: PartnerView;
  pomodoro: PomodoroSnapshot;
  baseStatusId: string;
  connected: boolean;
}

/**
 * The agent that runs on each partner's machine. It owns the local status,
 * folds the Pomodoro timer into it, keeps the partner's view in sync, and
 * redraws the bar whenever either side changes.
 */
export class App {
  private readonly catalog: StatusCatalog;
  private readonly pomodoro: Pomodoro;
  private readonly sync: SyncClient;
  private baseStatusId: string;
  private myState: StatusState;
  private partner: PartnerView;
  private connected = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private redrawTimer: ReturnType<typeof setInterval> | null = null;
  private drawing = false;

  constructor(
    private readonly cfg: Config,
    private readonly bar: BarDisplay,
    private readonly log: (line: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {
    this.catalog = StatusCatalog.withCustom(cfg.customStatuses);
    if (!this.catalog.has(cfg.initialStatusId)) {
      throw new Error(`initialStatusId "${cfg.initialStatusId}" is not a known status`);
    }
    this.pomodoro = new Pomodoro({
      focusMin: cfg.pomodoro.focusMin,
      breakMin: cfg.pomodoro.breakMin,
      longBreakMin: cfg.pomodoro.longBreakMin,
      cyclesBeforeLongBreak: cfg.pomodoro.cyclesBeforeLongBreak,
      autoContinue: cfg.pomodoro.autoContinue,
    });
    this.baseStatusId = cfg.initialStatusId;
    this.myState = this.computeMyState(this.now());
    this.partner = { peerId: null, name: cfg.partnerName, presence: 'offline', state: null };

    this.sync = new SyncClient({
      url: cfg.sync.url,
      room: cfg.sync.room,
      peerId: `${cfg.name}-${cfg.sync.room}`,
      name: cfg.name,
      partnerName: cfg.partnerName,
      staleAfterMs: cfg.render.partnerStaleAfterSec * 1000,
      onPartner: (view) => {
        this.partner = view;
        this.log(`[sync] partner ${view.name}: ${view.presence}${view.state ? ` (${view.state.label})` : ''}`);
        void this.redraw();
      },
      onConnection: (c) => {
        this.connected = c;
        this.log(`[sync] relay ${c ? 'connected' : 'disconnected'}`);
      },
    });
  }

  /** Fold the current Pomodoro phase into a StatusState. */
  private computeMyState(now: number): StatusState {
    const snap = this.pomodoro.snapshot(now);
    if (snap.phase === 'idle') {
      return this.catalog.toState(this.baseStatusId, now);
    }
    const statusId = snap.phase === 'focus' ? this.cfg.pomodoro.focusStatusId : this.cfg.pomodoro.breakStatusId;
    const id = this.catalog.has(statusId) ? statusId : this.baseStatusId;
    const state = this.catalog.toState(id, now);
    state.timer = {
      kind: snap.phase,
      endsAt: snap.endsAt !== null ? Math.round(snap.endsAt / 1000) : Math.round((now + snap.remainingMs) / 1000),
      paused: !snap.running,
      remainingMs: snap.remainingMs,
      label: phaseLabel(snap.phase),
    };
    return state;
  }

  async start(): Promise<void> {
    this.myState = this.computeMyState(this.now());
    this.sync.start(this.myState);
    await this.redraw();
    // Advance the Pomodoro across phase boundaries.
    this.pollTimer = setInterval(() => this.tick(), 1000);
    // Periodically refresh the device so elements survive reconnects/timeouts.
    this.redrawTimer = setInterval(() => void this.redraw(), 30_000);
    this.log(`[app] ${this.cfg.name} → ${this.bar.describe()}, room "${this.cfg.sync.room}"`);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.redrawTimer) clearInterval(this.redrawTimer);
    this.pollTimer = null;
    this.redrawTimer = null;
    this.sync.stop();
    try {
      await this.bar.clear();
    } catch {
      /* device may be gone; ignore on shutdown */
    }
  }

  private tick(): void {
    const now = this.now();
    if (this.pomodoro.poll(now)) {
      this.log(`[pomodoro] → ${this.pomodoro.snapshot(now).phase}`);
      this.broadcast(now);
    }
  }

  /** Recompute local state, push it to the partner, and redraw. */
  private broadcast(now: number): void {
    this.myState = this.computeMyState(now);
    this.sync.publish(this.myState);
    void this.redraw();
  }

  private async redraw(): Promise<void> {
    if (this.drawing) return;
    this.drawing = true;
    try {
      const frame = composeFrame({
        me: { name: this.cfg.name, state: this.myState },
        partner: this.partner,
        now: this.now(),
        options: { backgroundDim: this.cfg.render.backgroundDim, priority: this.cfg.bar.priority },
      });
      await this.bar.draw(frame);
    } catch (err) {
      this.log(`[bar] draw failed: ${(err as Error).message}`);
    } finally {
      this.drawing = false;
    }
  }

  // ---- commands (used by CLI / control API / keyboard) ----

  setStatus(id: string): { ok: boolean; message: string } {
    if (!this.catalog.has(id)) return { ok: false, message: `unknown status "${id}"` };
    this.baseStatusId = id;
    // Changing status manually ends any running Pomodoro.
    this.pomodoro.stop();
    this.broadcast(this.now());
    return { ok: true, message: `status set to ${id}` };
  }

  pomodoro_start(): string {
    this.pomodoro.start(this.now());
    this.broadcast(this.now());
    return 'pomodoro started';
  }
  pomodoro_pause(): string {
    this.pomodoro.pause(this.now());
    this.broadcast(this.now());
    return 'pomodoro paused';
  }
  pomodoro_resume(): string {
    this.pomodoro.resume(this.now());
    this.broadcast(this.now());
    return 'pomodoro resumed';
  }
  pomodoro_stop(): string {
    this.pomodoro.stop();
    this.broadcast(this.now());
    return 'pomodoro stopped';
  }
  pomodoro_skip(): string {
    this.pomodoro.skip(this.now());
    this.broadcast(this.now());
    return 'pomodoro skipped to next phase';
  }

  listStatuses() {
    return this.catalog.list();
  }

  snapshot(): AppSnapshot {
    return {
      me: { name: this.cfg.name, state: this.myState },
      partner: this.partner,
      pomodoro: this.pomodoro.snapshot(this.now()),
      baseStatusId: this.baseStatusId,
      connected: this.connected,
    };
  }
}
