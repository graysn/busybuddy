import type { StatusState, StatusDefinition } from './types.js';

/**
 * Reads the status you set with the *physical controls* on the BUSY Bar and
 * turns it into a BusyBuddy status.
 *
 * The device reports its state at `GET /api/busy/snapshot`. Two pieces matter:
 *   - `busy_bar_settings.theme` — the status "card" you selected on the device
 *     (e.g. "on_call", "on_air", "focus"). This is your presence.
 *   - `snapshot.type` — whether a BUSY/CUSTOM session (timer) is running, and
 *     how much time is left. NOT_STARTED means no timer.
 *
 * Example payloads (from a real device):
 *   idle:    {"snapshot":{"type":"NOT_STARTED","busy_bar_settings":{"theme":"on_call",...}},...}
 *   running: {"snapshot":{"type":"INTERVAL","is_paused":false,
 *             "current_interval_time_left_ms":1500000,...,"busy_bar_settings":{"theme":"on_call",...}},...}
 */

export interface DeviceStatus {
  /** Raw theme id from the device (e.g. "on_call"). */
  theme: string;
  /** A BUSY/CUSTOM session (timer) is active. */
  sessionActive: boolean;
  paused: boolean;
  /** Milliseconds left in the current session, or null (none / open-ended). */
  timeLeftMs: number | null;
}

interface RawSnapshot {
  snapshot?: {
    type?: string;
    is_paused?: boolean;
    time_left_ms?: number;
    current_interval_time_left_ms?: number;
    busy_bar_settings?: { theme?: string };
  };
}

/** Parse the /busy/snapshot payload into a compact DeviceStatus. */
export function parseSnapshot(raw: unknown): DeviceStatus {
  const snap = (raw as RawSnapshot)?.snapshot ?? {};
  const type = snap.type ?? 'NOT_STARTED';
  const sessionActive = type !== 'NOT_STARTED';
  const timeLeftMs =
    typeof snap.current_interval_time_left_ms === 'number'
      ? snap.current_interval_time_left_ms
      : typeof snap.time_left_ms === 'number'
        ? snap.time_left_ms
        : null;
  return {
    theme: snap.busy_bar_settings?.theme ?? 'available',
    sessionActive,
    paused: snap.is_paused ?? false,
    timeLeftMs: sessionActive ? timeLeftMs : null,
  };
}

/** Built-in mapping from device themes to a status label/color. */
const DEFAULT_THEME_MAP: Record<string, Omit<StatusDefinition, 'id'>> = {
  available: { label: 'Available', color: '#22C55EFF' },
  free: { label: 'Available', color: '#22C55EFF' },
  idle: { label: 'Available', color: '#22C55EFF' },
  focus: { label: 'Focus', color: '#3B82F6FF' },
  study: { label: 'Studying', color: '#3B82F6FF' },
  work: { label: 'Working', color: '#3B82F6FF' },
  working: { label: 'Working', color: '#3B82F6FF' },
  on_call: { label: 'On a call', color: '#EF4444FF', alert: true },
  on_air: { label: 'On air', color: '#DC2626FF', alert: true },
  recording: { label: 'Recording', color: '#DC2626FF', alert: true },
  meeting: { label: 'In a meeting', color: '#F59E0BFF', alert: true },
  in_meeting: { label: 'In a meeting', color: '#F59E0BFF', alert: true },
  busy: { label: 'Busy', color: '#EF4444FF', alert: true },
  do_not_disturb: { label: 'Do not disturb', color: '#A855F7FF' },
  dnd: { label: 'Do not disturb', color: '#A855F7FF' },
  brb: { label: 'BRB', color: '#14B8A6FF' },
  away: { label: 'Away', color: '#64748BFF' },
};

/** Title-case an unknown theme id (e.g. "movie_night" -> "Movie Night"). */
function humanize(theme: string): string {
  return theme
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export type ThemeOverride = StatusDefinition; // { id: theme, label, color, alert? }

/** Resolve a theme to a status definition, applying config overrides. */
export function themeToStatus(theme: string, overrides: ThemeOverride[] = []): StatusDefinition {
  const override = overrides.find((o) => o.id === theme);
  if (override) return override;
  const known = DEFAULT_THEME_MAP[theme];
  if (known) return { id: theme, ...known };
  return { id: theme, label: humanize(theme), color: '#3B82F6FF' };
}

/** Build a BusyBuddy StatusState from a device status snapshot. */
export function buildStateFromDevice(
  device: DeviceStatus,
  now: number,
  overrides: ThemeOverride[] = [],
): StatusState {
  const def = themeToStatus(device.theme, overrides);
  const state: StatusState = {
    statusId: def.id,
    label: def.label,
    color: def.color,
    alert: def.alert ?? false,
    timer: null,
    updatedAt: now,
  };
  if (device.sessionActive && device.timeLeftMs != null) {
    state.timer = {
      kind: 'focus',
      endsAt: Math.round((now + device.timeLeftMs) / 1000),
      paused: device.paused,
      remainingMs: device.timeLeftMs,
      label: def.label,
    };
  }
  return state;
}

/** Stable key for detecting meaningful changes (ignores the ticking clock). */
export function deviceStatusKey(d: DeviceStatus): string {
  return `${d.theme}|${d.sessionActive}|${d.paused}|${d.timeLeftMs == null ? 'n' : 'y'}`;
}

export interface SnapshotSource {
  get(path: string): Promise<unknown>;
}

/**
 * Polls the device's /busy/snapshot and reports the status you set on the bar.
 * Only fires `onChange` on meaningful transitions (theme / session / paused),
 * not on every tick, so the on-device countdown stays stable.
 */
export class DeviceStatusWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastKey: string | null = null;

  constructor(
    private readonly source: SnapshotSource,
    private readonly onChange: (status: DeviceStatus) => void,
    private readonly opts: { intervalMs?: number; onError?: (err: Error) => void } = {},
  ) {}

  start(): void {
    const interval = this.opts.intervalMs ?? 1500;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), interval);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    try {
      const raw = await this.source.get('busy/snapshot');
      const status = parseSnapshot(raw);
      const key = deviceStatusKey(status);
      if (key !== this.lastKey) {
        this.lastKey = key;
        this.onChange(status);
      }
    } catch (err) {
      this.opts.onError?.(err as Error);
    }
  }
}
