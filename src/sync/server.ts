import { WebSocketServer, WebSocket } from 'ws';
import { Hub, type Outbound } from './hub.js';
import { decodeClient, encode, type ServerMessage } from './protocol.js';

/**
 * WebSocket relay server. A thin adapter over the pure {@link Hub}: it assigns
 * a connection id per socket, decodes/validates incoming messages, and
 * dispatches the Hub's outbound messages to the right sockets.
 *
 * Run this on any host both partners can reach — a home server, a Raspberry Pi,
 * or a small VPS. It stores no history and needs no database.
 */
export interface SyncServerOptions {
  port: number;
  host?: string;
}

export class SyncServer {
  private readonly hub = new Hub();
  private readonly sockets = new Map<string, WebSocket>();
  private wss: WebSocketServer | null = null;
  private nextId = 1;

  constructor(private readonly options: SyncServerOptions) {}

  private dispatch(out: Outbound[]): void {
    for (const { connId, msg } of out) {
      const ws = this.sockets.get(connId);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
    }
  }

  private send(connId: string, msg: ServerMessage): void {
    this.dispatch([{ connId, msg }]);
  }

  start(): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.options.port, host: this.options.host });
      this.wss = wss;

      wss.on('error', reject);

      wss.on('connection', (ws) => {
        const connId = `c${this.nextId++}`;
        this.sockets.set(connId, ws);

        ws.on('message', (data) => {
          let msg;
          try {
            msg = decodeClient(data.toString());
          } catch {
            this.send(connId, { type: 'error', message: 'malformed message' });
            return;
          }
          switch (msg.type) {
            case 'hello':
              this.dispatch(
                this.hub.join(connId, {
                  room: msg.room,
                  peerId: msg.peerId,
                  name: msg.name,
                  state: msg.state,
                }),
              );
              break;
            case 'state':
              this.dispatch(this.hub.setState(connId, msg.state));
              break;
            case 'ping':
              this.send(connId, { type: 'pong' });
              break;
          }
        });

        const cleanup = () => {
          this.dispatch(this.hub.leave(connId));
          this.sockets.delete(connId);
        };
        ws.on('close', cleanup);
        ws.on('error', cleanup);
      });

      wss.on('listening', () => {
        const addr = wss.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.options.port;
        resolve({ port });
      });
    });
  }

  async stop(): Promise<void> {
    for (const ws of this.sockets.values()) ws.close();
    this.sockets.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    this.wss = null;
  }

  connectionCount(): number {
    return this.hub.size();
  }
}
