import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * BusyBuddy configuration. Loaded from a JSON file (default
 * `busybuddy.config.json`) with a few environment-variable overrides so
 * secrets (tokens/passwords) can stay out of the file if preferred.
 */

const colorSchema = z
  .string()
  .regex(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'must be #RRGGBB or #RRGGBBAA');

const statusDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: colorSchema,
  alert: z.boolean().optional(),
});

const barSchema = z.object({
  /** IP, hostname, or full URL of the BUSY Bar (or the cloud proxy). */
  addr: z.string().min(1).default('10.0.4.20'),
  /** Bearer token for the cloud proxy (https://cloud.busy.app/api-tokens). */
  token: z.string().optional(),
  /** Optional local HTTP access password configured on the device. */
  httpAccessPassword: z.string().optional(),
  /** Request timeout in ms for device calls. */
  timeout: z.number().int().positive().default(3000),
  /**
   * Draw priority [1,100]. Built-in apps draw at 10 and an active BUSY/CUSTOM
   * work session at 90; the default 60 keeps BusyBuddy above ordinary apps
   * while still yielding to a manually started work session.
   */
  priority: z.number().int().min(1).max(100).default(60),
});

const syncSchema = z.object({
  /** WebSocket URL of the relay (run `busybuddy serve` on any reachable host). */
  url: z.string().url().default('ws://127.0.0.1:8787'),
  /** Shared room code — both partners must use the same one to be paired. */
  room: z.string().min(1),
});

const pomodoroSchema = z.object({
  focusMin: z.number().positive().default(25),
  breakMin: z.number().positive().default(5),
  longBreakMin: z.number().positive().default(15),
  /** Number of focus sessions before a long break. */
  cyclesBeforeLongBreak: z.number().int().positive().default(4),
  /** Status id to switch to while a focus session runs. */
  focusStatusId: z.string().default('focus'),
  /** Status id to switch to during breaks. */
  breakStatusId: z.string().default('brb'),
  /** Automatically start the next phase when one ends. */
  autoContinue: z.boolean().default(true),
});

export const configSchema = z.object({
  /** Your display name (shown on your partner's bar). */
  name: z.string().min(1).default('Me'),
  /** Your partner's display name (shown on your bar until they connect). */
  partnerName: z.string().min(1).default('Partner'),
  /** Status id to start in. */
  initialStatusId: z.string().default('available'),
  bar: barSchema.default({}),
  sync: syncSchema,
  pomodoro: pomodoroSchema.default({}),
  /** Extra/override status definitions. */
  customStatuses: z.array(statusDefSchema).default([]),
  /** Local control API port (`busybuddy set`/`pomodoro` talk to this). */
  controlPort: z.number().int().positive().default(8788),
  render: z
    .object({
      /** Dim factor applied to card background colors (0-1). */
      backgroundDim: z.number().min(0).max(1).default(0.5),
      /** Seconds after which a silent partner is shown as "stale". */
      partnerStaleAfterSec: z.number().positive().default(45),
    })
    .default({}),
});

export type Config = z.infer<typeof configSchema>;
export type StatusDef = z.infer<typeof statusDefSchema>;

/** Apply environment overrides for secrets/connection so files stay clean. */
function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const bar = { ...(raw.bar as Record<string, unknown> | undefined) };
  const sync = { ...(raw.sync as Record<string, unknown> | undefined) };
  if (process.env.BUSYBUDDY_BAR_ADDR) bar.addr = process.env.BUSYBUDDY_BAR_ADDR;
  if (process.env.BUSYBUDDY_BAR_TOKEN) bar.token = process.env.BUSYBUDDY_BAR_TOKEN;
  if (process.env.BUSYBUDDY_BAR_PASSWORD) bar.httpAccessPassword = process.env.BUSYBUDDY_BAR_PASSWORD;
  if (process.env.BUSYBUDDY_SYNC_URL) sync.url = process.env.BUSYBUDDY_SYNC_URL;
  if (process.env.BUSYBUDDY_ROOM) sync.room = process.env.BUSYBUDDY_ROOM;
  return { ...raw, bar, sync };
}

export function parseConfig(raw: unknown): Config {
  const withEnv = applyEnvOverrides((raw ?? {}) as Record<string, unknown>);
  return configSchema.parse(withEnv);
}

export function loadConfig(path = 'busybuddy.config.json'): Config {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    // Allow a config-less run driven purely by env vars (room + url required).
    return parseConfig({});
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Could not parse ${path}: ${(err as Error).message}`);
  }
  return parseConfig(json);
}
