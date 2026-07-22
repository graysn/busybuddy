import type { ServerMessage } from './protocol.js';
import type { StatusState } from '../types.js';

/**
 * Pure room hub. Holds the roster of connected peers per room and computes the
 * messages that should be sent in response to each event. It knows nothing
 * about WebSockets — the server adapter feeds it events and dispatches the
 * returned outbound messages. This keeps all routing logic unit-testable.
 */

export interface Outbound {
  connId: string;
  msg: ServerMessage;
}

interface PeerEntry {
  connId: string;
  room: string;
  peerId: string;
  name: string;
  state: StatusState | null;
}

export interface JoinParams {
  room: string;
  peerId: string;
  name: string;
  state: StatusState | null;
}

export class Hub {
  private readonly byConn = new Map<string, PeerEntry>();
  private readonly rooms = new Map<string, Set<string>>();

  private roomMembers(room: string): Set<string> {
    let set = this.rooms.get(room);
    if (!set) {
      set = new Set();
      this.rooms.set(room, set);
    }
    return set;
  }

  private othersInRoom(room: string, exceptConnId: string): PeerEntry[] {
    const members = this.rooms.get(room);
    if (!members) return [];
    const out: PeerEntry[] = [];
    for (const connId of members) {
      if (connId === exceptConnId) continue;
      const entry = this.byConn.get(connId);
      if (entry) out.push(entry);
    }
    return out;
  }

  /** Register a connection in a room. Returns messages to dispatch. */
  join(connId: string, params: JoinParams): Outbound[] {
    // If this connection already joined, drop it from its previous room first.
    if (this.byConn.has(connId)) this.leave(connId);

    const entry: PeerEntry = {
      connId,
      room: params.room,
      peerId: params.peerId,
      name: params.name,
      state: params.state,
    };
    this.byConn.set(connId, entry);
    this.roomMembers(params.room).add(connId);

    const out: Outbound[] = [{ connId, msg: { type: 'welcome', peerId: params.peerId } }];

    // Tell the newcomer about everyone already here...
    for (const other of this.othersInRoom(params.room, connId)) {
      out.push({
        connId,
        msg: { type: 'peer_state', peerId: other.peerId, name: other.name, state: other.state },
      });
      // ...and tell everyone already here about the newcomer.
      out.push({
        connId: other.connId,
        msg: { type: 'peer_state', peerId: entry.peerId, name: entry.name, state: entry.state },
      });
    }

    return out;
  }

  /** Update a connection's state and broadcast it to the rest of its room. */
  setState(connId: string, state: StatusState): Outbound[] {
    const entry = this.byConn.get(connId);
    if (!entry) return [];
    entry.state = state;
    return this.othersInRoom(entry.room, connId).map((other) => ({
      connId: other.connId,
      msg: { type: 'peer_state', peerId: entry.peerId, name: entry.name, state },
    }));
  }

  /** Remove a connection and notify its room. */
  leave(connId: string): Outbound[] {
    const entry = this.byConn.get(connId);
    if (!entry) return [];
    this.byConn.delete(connId);
    this.rooms.get(entry.room)?.delete(connId);
    if (this.rooms.get(entry.room)?.size === 0) this.rooms.delete(entry.room);
    return this.othersInRoom(entry.room, connId).map((other) => ({
      connId: other.connId,
      msg: { type: 'peer_left', peerId: entry.peerId },
    }));
  }

  /** Number of active connections (for diagnostics/tests). */
  size(): number {
    return this.byConn.size;
  }

  roomSize(room: string): number {
    return this.rooms.get(room)?.size ?? 0;
  }
}
