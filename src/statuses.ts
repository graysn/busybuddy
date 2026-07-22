import type { StatusDefinition, StatusState } from './types.js';

/**
 * Built-in statuses. Colors are chosen to read clearly on the LED matrix and to
 * be distinguishable at a glance from across a room. `alert: true` blinks the
 * notification LED so the *other* bar visibly reacts when you switch to it
 * (e.g. you start recording, your partner's bar flashes).
 */
export const DEFAULT_STATUSES: StatusDefinition[] = [
  { id: 'available', label: 'Available', color: '#22C55EFF' },
  { id: 'focus', label: 'Focus', color: '#3B82F6FF' },
  { id: 'meeting', label: 'In a meeting', color: '#F59E0BFF', alert: true },
  { id: 'call', label: 'On a call', color: '#EF4444FF', alert: true },
  { id: 'recording', label: 'Recording', color: '#DC2626FF', alert: true },
  { id: 'dnd', label: 'Do not disturb', color: '#A855F7FF' },
  { id: 'brb', label: 'BRB', color: '#14B8A6FF' },
  { id: 'away', label: 'Away', color: '#64748BFF' },
  { id: 'offline', label: 'Offline', color: '#334155FF' },
];

export class StatusCatalog {
  private readonly byId = new Map<string, StatusDefinition>();

  constructor(defs: StatusDefinition[]) {
    for (const def of defs) this.byId.set(def.id, def);
  }

  /**
   * Merge user-defined statuses on top of the defaults. A custom status sharing
   * an id overrides the built-in one; new ids are appended.
   */
  static withCustom(custom: StatusDefinition[] = []): StatusCatalog {
    const merged = new Map<string, StatusDefinition>();
    for (const def of DEFAULT_STATUSES) merged.set(def.id, def);
    for (const def of custom) merged.set(def.id, def);
    return new StatusCatalog([...merged.values()]);
  }

  list(): StatusDefinition[] {
    return [...this.byId.values()];
  }

  get(id: string): StatusDefinition | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Build a fresh StatusState from a status id, stamped with `now` (ms). */
  toState(id: string, now: number): StatusState {
    const def = this.byId.get(id);
    if (!def) throw new Error(`Unknown status: ${id}`);
    return {
      statusId: def.id,
      label: def.label,
      color: def.color,
      alert: def.alert ?? false,
      timer: null,
      updatedAt: now,
    };
  }
}
