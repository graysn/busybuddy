import { describe, it, expect } from 'vitest';
import { parseColor, formatColor, luminance, dim, contrastColor } from './color.js';

describe('color', () => {
  it('parses #RRGGBB and defaults alpha to opaque', () => {
    expect(parseColor('#FF8000')).toEqual({ r: 255, g: 128, b: 0, a: 255 });
  });

  it('parses #RRGGBBAA', () => {
    expect(parseColor('#10203040')).toEqual({ r: 16, g: 32, b: 48, a: 64 });
  });

  it('rejects invalid colors', () => {
    expect(() => parseColor('nope')).toThrow();
    expect(() => parseColor('#12345')).toThrow();
  });

  it('round-trips through format', () => {
    expect(formatColor(parseColor('#DC2626FF'))).toBe('#DC2626FF');
  });

  it('computes luminance (white brighter than black)', () => {
    expect(luminance(parseColor('#FFFFFF'))).toBeCloseTo(1, 5);
    expect(luminance(parseColor('#000000'))).toBeCloseTo(0, 5);
  });

  it('dims by factor', () => {
    expect(dim('#FFFFFFFF', 0.5)).toBe('#808080FF');
    expect(dim('#FFFFFFFF', 0)).toBe('#000000FF');
    expect(dim('#20406080', 1)).toBe('#20406080');
  });

  it('picks a readable foreground', () => {
    expect(contrastColor('#FFFF00FF')).toBe('#000000FF'); // yellow → black text
    expect(contrastColor('#1E3A8AFF')).toBe('#FFFFFFFF'); // dark blue → white text
  });
});
