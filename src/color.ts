/**
 * Small color helpers for the BUSY Bar's #RRGGBBAA color format.
 *
 * The display is a 72x16 LED matrix, so legibility matters: we dim status
 * colors when used as a text background and pick a black/white foreground
 * based on perceived luminance.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Parse a #RRGGBB or #RRGGBBAA string. Missing alpha defaults to fully opaque. */
export function parseColor(input: string): Rgba {
  const m = HEX.exec(input.trim());
  if (!m) throw new Error(`Invalid color: ${input}`);
  const hex = m[1]!;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
  return { r, g, b, a };
}

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Format an Rgba back to an uppercase #RRGGBBAA string. */
export function formatColor({ r, g, b, a }: Rgba): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}${h(a)}`;
}

/**
 * Relative luminance in [0,1] using the standard sRGB coefficients.
 * Alpha is ignored (we only care about the emitted light of the pixel).
 */
export function luminance(c: Rgba): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

/**
 * Scale a color toward black by `factor` (0 = black, 1 = unchanged).
 * Alpha is preserved. Used to keep a colored card background from washing out
 * the label text.
 */
export function dim(input: string, factor: number): string {
  const c = parseColor(input);
  const f = Math.max(0, Math.min(1, factor));
  return formatColor({ r: c.r * f, g: c.g * f, b: c.b * f, a: c.a });
}

/**
 * Pick a readable foreground (near-white or near-black) for text placed on the
 * given background color.
 */
export function contrastColor(background: string): string {
  const bg = parseColor(background);
  // Blend against black since the panel is unlit where alpha is low.
  const effective = { r: bg.r * (bg.a / 255), g: bg.g * (bg.a / 255), b: bg.b * (bg.a / 255), a: 255 };
  return luminance(effective) > 0.45 ? '#000000FF' : '#FFFFFFFF';
}
