import { describe, it, expect } from 'vitest';
import { Hub } from './hub.js';
import type { StatusState } from '../types.js';

const st = (label: string): StatusState => ({
  statusId: label.toLowerCase(),
  label,
  color: '#FFFFFFFF',
  alert: false,
  timer: null,
  updatedAt: 0,
});

describe('Hub', () => {
  it('introduces peers to each other on join', () => {
    const hub = new Hub();
    hub.join('c1', { room: 'r', peerId: 'A', name: 'Alice', state: st('Available') });
    const out = hub.join('c2', { room: 'r', peerId: 'B', name: 'Bob', state: st('Meeting') });

    // c2 gets a welcome + A's state; c1 is told about B.
    expect(out).toContainEqual({ connId: 'c2', msg: { type: 'welcome', peerId: 'B' } });
    expect(out).toContainEqual({
      connId: 'c2',
      msg: { type: 'peer_state', peerId: 'A', name: 'Alice', state: st('Available') },
    });
    expect(out).toContainEqual({
      connId: 'c1',
      msg: { type: 'peer_state', peerId: 'B', name: 'Bob', state: st('Meeting') },
    });
  });

  it('broadcasts state changes to the rest of the room', () => {
    const hub = new Hub();
    hub.join('c1', { room: 'r', peerId: 'A', name: 'Alice', state: null });
    hub.join('c2', { room: 'r', peerId: 'B', name: 'Bob', state: null });
    const out = hub.setState('c1', st('Focus'));
    expect(out).toEqual([
      { connId: 'c2', msg: { type: 'peer_state', peerId: 'A', name: 'Alice', state: st('Focus') } },
    ]);
  });

  it('notifies the room when a peer leaves', () => {
    const hub = new Hub();
    hub.join('c1', { room: 'r', peerId: 'A', name: 'Alice', state: null });
    hub.join('c2', { room: 'r', peerId: 'B', name: 'Bob', state: null });
    const out = hub.leave('c1');
    expect(out).toEqual([{ connId: 'c2', msg: { type: 'peer_left', peerId: 'A' } }]);
    expect(hub.roomSize('r')).toBe(1);
  });

  it('keeps separate rooms isolated', () => {
    const hub = new Hub();
    hub.join('c1', { room: 'r1', peerId: 'A', name: 'Alice', state: null });
    const out = hub.join('c2', { room: 'r2', peerId: 'B', name: 'Bob', state: null });
    // No cross-room introductions.
    expect(out).toEqual([{ connId: 'c2', msg: { type: 'welcome', peerId: 'B' } }]);
    expect(hub.setState('c1', st('X'))).toEqual([]);
  });

  it('re-homes a connection that re-joins a different room', () => {
    const hub = new Hub();
    hub.join('c1', { room: 'r1', peerId: 'A', name: 'Alice', state: null });
    hub.join('c1', { room: 'r2', peerId: 'A', name: 'Alice', state: null });
    expect(hub.roomSize('r1')).toBe(0);
    expect(hub.roomSize('r2')).toBe(1);
  });
});
