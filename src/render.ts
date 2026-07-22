import type { DisplayDrawParams } from '@busy-app/busy-lib';
import type { PartnerView, StatusState } from './types.js';
import { contrastColor, dim, parseColor, formatColor } from './color.js';

/**
 * Renderer: turns "my status" + "partner's status" into a single BUSY Bar draw
 * command for the 72x16 front display.
 *
 * Layout — the screen is split into two cards with a thin divider:
 *
 *   col:  0 ............ 34 | 35 36 | 37 ............ 71
 *         [    ME card    ] |  gap  | [  PARTNER card ]
 *
 * Each card shows the person's name (top) and either their status label or a
 * live Pomodoro countdown (bottom), on a background tinted with the status
 * color. Color alone communicates status from across the room; the text adds
 * detail up close.
 */

export const SCREEN_WIDTH = 72;
export const SCREEN_HEIGHT = 16;
const CARD_WIDTH = 35;
const DIVIDER_X = 35;
const DIVIDER_W = 2;
const LEFT_X = 0;
const RIGHT_X = 37;
const APP_NAME = 'busybuddy';

const OFFLINE_COLOR = '#334155FF';

type Element = DisplayDrawParams['elements'][number];
type Font = 'tiny' | 'small' | 'normal' | 'condensed' | 'bold' | 'large' | 'extra_large' | 'global';

/** Rough per-character advance widths (px), used only to decide when to scroll. */
const FONT_ADVANCE: Record<Font, number> = {
  tiny: 4,
  small: 4,
  condensed: 4,
  normal: 6,
  bold: 6,
  large: 8,
  extra_large: 10,
  global: 6,
};

export function estimateTextWidth(text: string, font: Font): number {
  return text.length * FONT_ADVANCE[font];
}

export interface RenderOptions {
  backgroundDim: number;
  priority: number;
}

export interface RenderInput {
  me: { name: string; state: StatusState | null };
  partner: PartnerView;
  now: number;
  options: RenderOptions;
}

function mmss(totalMs: number): string {
  const total = Math.max(0, Math.round(totalMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Blend a color's alpha down (used to fade stale/paused foregrounds). */
function fade(color: string, factor: number): string {
  const c = parseColor(color);
  return formatColor({ ...c, a: c.a * factor });
}

function rect(id: string, x: number, width: number, color: string): Element {
  return {
    id,
    type: 'rectangle',
    x,
    y: 0,
    display: 'front',
    timeout: 0,
    width,
    height: SCREEN_HEIGHT,
    fill: 'solid',
    fill_colors: [color],
    border_width: 0,
    border_color: '#00000000',
  } as Element;
}

function text(
  id: string,
  x: number,
  y: number,
  value: string,
  font: Font,
  color: string,
  width: number,
  scroll: boolean,
): Element {
  const el: Record<string, unknown> = {
    id,
    type: 'text',
    x,
    y,
    display: 'front',
    timeout: 0,
    text: value,
    font,
    color,
    width,
  };
  if (scroll) {
    el.scroll_rate = 40;
    el.scroll_start_delay = 1500;
    el.scroll_repeat_delay = 1500;
  }
  return el as Element;
}

function countdown(id: string, x: number, y: number, endsAtSec: number, color: string): Element {
  return {
    id,
    type: 'countdown',
    x,
    y,
    display: 'front',
    timeout: 0,
    timestamp: String(endsAtSec),
    color,
    direction: 'time_left',
    show_hours: 'when_non_zero',
  } as Element;
}

/**
 * Build the elements for one card.
 *
 * @param side   used to namespace element ids ('me' / 'partner')
 * @param originX left edge of the card
 * @param name   person's display name
 * @param state  their status (null = never received / offline)
 * @param dimmedFg when true, fade the text (partner is stale)
 */
function card(
  side: 'me' | 'partner',
  originX: number,
  name: string,
  state: StatusState | null,
  dimmedFg: boolean,
  opts: RenderOptions,
): Element[] {
  const baseColor = state ? state.color : OFFLINE_COLOR;
  const bg = dim(baseColor, opts.backgroundDim);
  let fg = contrastColor(bg);
  if (dimmedFg) fg = fade(fg, 0.55);
  const nameFg = fade(fg, 0.8);

  const els: Element[] = [rect(`${side}-bg`, originX, CARD_WIDTH, bg)];
  const pad = 1;
  const innerW = CARD_WIDTH - pad * 2;

  // Header: person's name.
  els.push(text(`${side}-name`, originX + pad, 1, name, 'tiny', nameFg, innerW, false));

  const timer = state?.timer ?? null;
  if (state && timer) {
    if (timer.paused) {
      const remaining = mmss(timer.remainingMs ?? 0);
      els.push(text(`${side}-timer`, originX + pad, 8, `${remaining}`, 'small', fade(fg, 0.7), innerW, false));
    } else {
      els.push(countdown(`${side}-timer`, originX + pad, 8, timer.endsAt, fg));
    }
  } else {
    const label = state ? state.label : 'Offline';
    const scroll = estimateTextWidth(label, 'small') > innerW;
    els.push(text(`${side}-status`, originX + pad, 8, label, 'small', fg, innerW, scroll));
  }

  return els;
}

/** Pick the LED notification color: an alerting status blinks the whole bar. */
function ledColor(me: StatusState | null, partner: StatusState | null): string | undefined {
  if (me?.alert) return me.color;
  if (partner?.alert) return partner.color;
  return undefined;
}

/**
 * Compose the full-screen draw command for both statuses. Pure and
 * deterministic given its inputs — the app calls this and hands the result to
 * the bar adapter.
 */
export function composeFrame(input: RenderInput): DisplayDrawParams {
  const { me, partner, options } = input;

  const partnerVisible = partner.presence !== 'offline' && partner.state !== null;
  const partnerState = partnerVisible ? partner.state : null;
  const partnerDimmed = partner.presence === 'stale';

  const elements: Element[] = [
    ...card('me', LEFT_X, me.name, me.state, false, options),
    rect('divider', DIVIDER_X, DIVIDER_W, '#000000FF'),
    ...card('partner', RIGHT_X, partner.name, partnerState, partnerDimmed, options),
  ];

  const params: DisplayDrawParams = {
    application_name: APP_NAME,
    priority: options.priority,
    elements,
  };

  const led = ledColor(me.state, partnerState);
  if (led) params.led_notification_color = led;

  return params;
}
