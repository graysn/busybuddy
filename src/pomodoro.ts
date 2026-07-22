/**
 * Pomodoro engine.
 *
 * Designed to be driven by an external clock: all methods take the current time
 * in ms, and `poll(now)` advances the state machine across phase boundaries.
 * This keeps the engine pure and trivially testable (no fake timers needed) —
 * the App layer just calls `poll` on an interval and after each user action.
 */

export type PomodoroPhase = 'idle' | 'focus' | 'break' | 'long_break';

export interface PomodoroConfig {
  focusMin: number;
  breakMin: number;
  longBreakMin: number;
  cyclesBeforeLongBreak: number;
  autoContinue: boolean;
}

export interface PomodoroSnapshot {
  phase: PomodoroPhase;
  running: boolean;
  /** Ms remaining in the current phase (0 when idle). */
  remainingMs: number;
  /** Unix ms the phase ends, when running; null when paused/idle. */
  endsAt: number | null;
  /** Number of completed focus sessions in the current run. */
  completedFocusSessions: number;
}

const MIN = 60_000;

export class Pomodoro {
  private phase: PomodoroPhase = 'idle';
  private running = false;
  private endsAt = 0;
  private remainingMs = 0;
  private completed = 0;

  constructor(private cfg: PomodoroConfig) {}

  /** Replace the configuration (durations apply to the next phase started). */
  configure(cfg: PomodoroConfig): void {
    this.cfg = cfg;
  }

  private durationMs(phase: PomodoroPhase): number {
    switch (phase) {
      case 'focus':
        return this.cfg.focusMin * MIN;
      case 'break':
        return this.cfg.breakMin * MIN;
      case 'long_break':
        return this.cfg.longBreakMin * MIN;
      case 'idle':
        return 0;
    }
  }

  private beginRunning(phase: PomodoroPhase, now: number): void {
    this.phase = phase;
    this.running = true;
    this.remainingMs = this.durationMs(phase);
    this.endsAt = now + this.remainingMs;
  }

  private beginPaused(phase: PomodoroPhase): void {
    this.phase = phase;
    this.running = false;
    this.remainingMs = this.durationMs(phase);
    this.endsAt = 0;
  }

  /** The phase that follows the current one, and whether it's a long break. */
  private nextPhaseAfter(phase: PomodoroPhase): PomodoroPhase {
    if (phase === 'focus') {
      const done = this.completed + 1;
      return done % this.cfg.cyclesBeforeLongBreak === 0 ? 'long_break' : 'break';
    }
    return 'focus';
  }

  /**
   * Start focusing. From idle begins a focus session; from a paused phase this
   * resumes it. No-op if already running.
   */
  start(now: number): boolean {
    if (this.running) return false;
    if (this.phase === 'idle') {
      this.beginRunning('focus', now);
    } else {
      this.resume(now);
    }
    return true;
  }

  pause(now: number): boolean {
    if (!this.running || this.phase === 'idle') return false;
    this.remainingMs = Math.max(0, this.endsAt - now);
    this.running = false;
    this.endsAt = 0;
    return true;
  }

  resume(now: number): boolean {
    if (this.running || this.phase === 'idle') return false;
    this.running = true;
    this.endsAt = now + this.remainingMs;
    return true;
  }

  /** End the run entirely and reset the cycle counter. */
  stop(): boolean {
    if (this.phase === 'idle' && !this.running) return false;
    this.phase = 'idle';
    this.running = false;
    this.endsAt = 0;
    this.remainingMs = 0;
    this.completed = 0;
    return true;
  }

  /** Immediately finish the current phase and move to the next one. */
  skip(now: number): boolean {
    if (this.phase === 'idle') return false;
    this.advance(now);
    return true;
  }

  /** Transition from the current (finished) phase to the next. */
  private advance(now: number): void {
    const next = this.nextPhaseAfter(this.phase);
    if (this.phase === 'focus') this.completed += 1;
    if (this.cfg.autoContinue) {
      this.beginRunning(next, now);
    } else {
      this.beginPaused(next);
    }
  }

  /**
   * Advance across any elapsed phase boundaries. Returns true if the phase
   * changed (so the caller can re-render / re-sync).
   */
  poll(now: number): boolean {
    if (!this.running || this.phase === 'idle') return false;
    let changed = false;
    // Loop in case a very long gap crossed multiple auto-continued phases.
    while (this.running && now >= this.endsAt) {
      this.advance(now);
      changed = true;
      if (!this.running) break; // paused at boundary (autoContinue off)
    }
    return changed;
  }

  snapshot(now: number): PomodoroSnapshot {
    const remainingMs = this.running ? Math.max(0, this.endsAt - now) : this.remainingMs;
    return {
      phase: this.phase,
      running: this.running,
      remainingMs,
      endsAt: this.running ? this.endsAt : null,
      completedFocusSessions: this.completed,
    };
  }
}

export function phaseLabel(phase: PomodoroPhase): string {
  switch (phase) {
    case 'focus':
      return 'Focus';
    case 'break':
      return 'Break';
    case 'long_break':
      return 'Long break';
    case 'idle':
      return '';
  }
}
