/**
 * Shared domain types for BusyBuddy.
 *
 * These types are transport-agnostic: they describe the *status* of a person,
 * independent of how it is drawn on a BUSY Bar or shipped across the sync
 * channel. The renderer turns a pair of these into device draw commands; the
 * sync layer moves them between the two paired agents.
 */

/** A live timer attached to a status (drives the Pomodoro countdown). */
export interface StatusTimer {
  /** What the timer represents. */
  kind: 'focus' | 'break' | 'long_break' | 'custom';
  /** Unix time (seconds) the timer finishes. Used for the device countdown. */
  endsAt: number;
  /** When paused, the countdown is frozen and this holds the remaining ms. */
  paused: boolean;
  /** Milliseconds remaining while paused (ignored when running). */
  remainingMs?: number;
  /** Short label for the timer phase, e.g. "Focus" or "Break". */
  label?: string;
}

/**
 * A single person's current status. This is the unit of state that is stored,
 * rendered, and synced.
 */
export interface StatusState {
  /** Stable identifier of the underlying status definition (e.g. "available"). */
  statusId: string;
  /** Human label shown on the bar (printable ASCII only). */
  label: string;
  /** Status color in #RRGGBBAA form. */
  color: string;
  /**
   * When true, the bar blinks its notification LED to grab attention
   * (e.g. "Recording" or "On a call"). Used for the whole-frame LED cue.
   */
  alert: boolean;
  /** Optional live timer (Pomodoro). Null/undefined when no timer is running. */
  timer?: StatusTimer | null;
  /** Unix ms when this state was last updated (used for staleness/ordering). */
  updatedAt: number;
}

/** A named, reusable status the user can switch to. */
export interface StatusDefinition {
  id: string;
  label: string;
  color: string;
  /** Blink the LED when this status is active. */
  alert?: boolean;
}

/** Presence of the partner as seen by the local agent. */
export type Presence = 'online' | 'stale' | 'offline';

/** Partner-side view held locally: their last known state plus liveness. */
export interface PartnerView {
  peerId: string | null;
  name: string;
  presence: Presence;
  state: StatusState | null;
}
