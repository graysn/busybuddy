import { BusyBar, type DisplayDrawParams } from '@busy-app/busy-lib';
import type { Config } from './config.js';

/**
 * Bar adapter. The app only depends on this small interface, so it can run
 * against a real device, a mock (for `--dry-run` and tests), or anything else.
 */
export interface BarDisplay {
  draw(params: DisplayDrawParams): Promise<void>;
  clear(): Promise<void>;
  /** Human-readable target description for logging. */
  describe(): string;
}

/** Real device, backed by the official @busy-app/busy-lib HTTP client. */
export class BusyLibBar implements BarDisplay {
  private readonly bar: BusyBar;

  constructor(private readonly cfg: Config['bar']) {
    this.bar = new BusyBar({
      addr: cfg.addr,
      token: cfg.token,
      HTTPAccessPassword: cfg.httpAccessPassword,
      timeout: cfg.timeout,
    });
  }

  async draw(params: DisplayDrawParams): Promise<void> {
    await this.bar.DisplayDraw(params);
  }

  async clear(): Promise<void> {
    await this.bar.DisplayClear({ application_name: 'busybuddy' });
  }

  describe(): string {
    return `BUSY Bar @ ${this.cfg.addr}`;
  }
}

/**
 * Mock bar for dry runs and tests. Records the last frame and can print a rough
 * ASCII schematic of the two cards so you can preview the layout without a
 * device.
 */
export class MockBar implements BarDisplay {
  lastFrame: DisplayDrawParams | null = null;
  drawCount = 0;

  constructor(private readonly log: (line: string) => void = () => {}) {}

  async draw(params: DisplayDrawParams): Promise<void> {
    this.lastFrame = params;
    this.drawCount += 1;
    this.log(this.render(params));
  }

  async clear(): Promise<void> {
    this.lastFrame = null;
    this.log('[bar] cleared');
  }

  describe(): string {
    return 'MockBar (dry-run)';
  }

  private render(params: DisplayDrawParams): string {
    const texts = params.elements.filter(
      (e): e is Extract<typeof e, { type: 'text' }> => e.type === 'text',
    );
    const countdowns = params.elements.filter((e) => e.type === 'countdown');
    const me = texts.filter((t) => t.id.startsWith('me-')).map((t) => t.text);
    const partner = texts.filter((t) => t.id.startsWith('partner-')).map((t) => t.text);
    const timers = countdowns.length ? ` (+${countdowns.length} live timer)` : '';
    const led = params.led_notification_color ? ` LED:${params.led_notification_color}` : '';
    const left = me.join(' / ') || '—';
    const right = partner.join(' / ') || '—';
    return `[bar] ┌─ me: ${left.padEnd(22)}│ partner: ${right}${timers}${led}`;
  }
}

export function createBar(cfg: Config, dryRun: boolean, log: (line: string) => void): BarDisplay {
  return dryRun ? new MockBar(log) : new BusyLibBar(cfg.bar);
}
