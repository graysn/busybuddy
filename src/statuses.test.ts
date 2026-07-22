import { describe, it, expect } from 'vitest';
import { StatusCatalog, DEFAULT_STATUSES } from './statuses.js';

describe('StatusCatalog', () => {
  it('includes the built-in statuses by default', () => {
    const cat = StatusCatalog.withCustom();
    expect(cat.has('available')).toBe(true);
    expect(cat.has('recording')).toBe(true);
    expect(cat.list().length).toBe(DEFAULT_STATUSES.length);
  });

  it('overrides a built-in and appends new custom statuses', () => {
    const cat = StatusCatalog.withCustom([
      { id: 'available', label: 'Free', color: '#00FF00FF' },
      { id: 'gaming', label: 'Gaming', color: '#FF00FFFF' },
    ]);
    expect(cat.get('available')?.label).toBe('Free');
    expect(cat.has('gaming')).toBe(true);
    expect(cat.list().length).toBe(DEFAULT_STATUSES.length + 1);
  });

  it('builds a StatusState carrying the alert flag', () => {
    const cat = StatusCatalog.withCustom();
    const s = cat.toState('recording', 123);
    expect(s).toMatchObject({ statusId: 'recording', label: 'Recording', alert: true, updatedAt: 123, timer: null });
  });

  it('throws for an unknown status', () => {
    expect(() => StatusCatalog.withCustom().toState('nope', 0)).toThrow();
  });
});
