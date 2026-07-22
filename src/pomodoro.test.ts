import { describe, it, expect } from 'vitest';
import { Pomodoro, type PomodoroConfig } from './pomodoro.js';

const CFG: PomodoroConfig = {
  focusMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  cyclesBeforeLongBreak: 4,
  autoContinue: true,
};

const MIN = 60_000;

describe('Pomodoro', () => {
  it('starts a focus session', () => {
    const p = new Pomodoro(CFG);
    let t = 1_000_000;
    expect(p.start(t)).toBe(true);
    const snap = p.snapshot(t);
    expect(snap.phase).toBe('focus');
    expect(snap.running).toBe(true);
    expect(snap.remainingMs).toBe(25 * MIN);
    expect(snap.endsAt).toBe(t + 25 * MIN);
  });

  it('counts down as time passes', () => {
    const p = new Pomodoro(CFG);
    const t0 = 0;
    p.start(t0);
    expect(p.snapshot(t0 + 10 * MIN).remainingMs).toBe(15 * MIN);
  });

  it('auto-continues focus -> break -> focus', () => {
    const p = new Pomodoro(CFG);
    p.start(0);
    // Poll just before the boundary: nothing changes.
    expect(p.poll(25 * MIN - 1)).toBe(false);
    // At the boundary: advance to break.
    expect(p.poll(25 * MIN)).toBe(true);
    let snap = p.snapshot(25 * MIN);
    expect(snap.phase).toBe('break');
    expect(snap.running).toBe(true);
    expect(snap.completedFocusSessions).toBe(1);
    // After the break: back to focus.
    expect(p.poll(30 * MIN)).toBe(true);
    snap = p.snapshot(30 * MIN);
    expect(snap.phase).toBe('focus');
  });

  it('gives a long break after the configured number of focus sessions', () => {
    const p = new Pomodoro({ ...CFG, focusMin: 1, breakMin: 1, longBreakMin: 10, cyclesBeforeLongBreak: 4 });
    let t = 0;
    p.start(t);
    const phases: string[] = [];
    // Simulate 8 minutes of wall clock, polling each minute.
    for (let i = 1; i <= 8; i++) {
      t = i * MIN;
      p.poll(t);
      phases.push(p.snapshot(t).phase);
    }
    // focus(1m) break focus break focus break focus long_break ...
    expect(phases[0]).toBe('break'); // after 1st focus
    expect(p.snapshot(t).completedFocusSessions).toBe(4);
    // The 4th break should be a long break.
    expect(phases).toContain('long_break');
  });

  it('pauses and resumes preserving remaining time', () => {
    const p = new Pomodoro(CFG);
    p.start(0);
    p.pause(10 * MIN);
    const paused = p.snapshot(10 * MIN);
    expect(paused.running).toBe(false);
    expect(paused.remainingMs).toBe(15 * MIN);
    // Time passing while paused does not change remaining.
    expect(p.snapshot(12 * MIN).remainingMs).toBe(15 * MIN);
    // Resume at a later time; it should still have 15m left, ending 15m later.
    expect(p.resume(20 * MIN)).toBe(true);
    expect(p.snapshot(20 * MIN).endsAt).toBe(35 * MIN);
  });

  it('stop resets to idle and clears the cycle count', () => {
    const p = new Pomodoro(CFG);
    p.start(0);
    p.poll(25 * MIN); // one focus completed
    expect(p.snapshot(25 * MIN).completedFocusSessions).toBe(1);
    expect(p.stop()).toBe(true);
    const snap = p.snapshot(25 * MIN);
    expect(snap.phase).toBe('idle');
    expect(snap.completedFocusSessions).toBe(0);
  });

  it('skip jumps to the next phase immediately', () => {
    const p = new Pomodoro(CFG);
    p.start(0);
    p.skip(5 * MIN);
    expect(p.snapshot(5 * MIN).phase).toBe('break');
  });

  it('when autoContinue is off it pauses at the boundary', () => {
    const p = new Pomodoro({ ...CFG, autoContinue: false });
    p.start(0);
    expect(p.poll(25 * MIN)).toBe(true);
    const snap = p.snapshot(25 * MIN);
    expect(snap.phase).toBe('break');
    expect(snap.running).toBe(false);
    // Poll again does not skip ahead while paused.
    expect(p.poll(60 * MIN)).toBe(false);
  });
});
