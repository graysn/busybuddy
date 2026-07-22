import { createServer, type Server, type ServerResponse } from 'node:http';
import { SyncServer } from '../sync/server.js';
import { EmulatorServer } from '../emulator/server.js';
import { App } from '../app.js';
import { DeviceBar } from '../bar.js';
import { parseConfig } from '../config.js';
import { renderPlaygroundPage } from './page.js';

/**
 * Interactive playground: the whole BusyBuddy stack in one process, driven by
 * you from a web page. It runs the relay, two BUSY Bar emulators, and two
 * agents ("you" and your "partner"), then serves a control panel where you set
 * each side's status / Pomodoro and watch both emulated bars react live — the
 * real thing, not a scripted sequence.
 */
export interface PlaygroundOptions {
  port: number;
  youName?: string;
  partnerName?: string;
}

export class Playground {
  private relay!: SyncServer;
  private emuYou!: EmulatorServer;
  private emuPartner!: EmulatorServer;
  private appYou!: App;
  private appPartner!: App;
  private http: Server | null = null;
  private readonly youName: string;
  private readonly partnerName: string;

  constructor(private readonly options: PlaygroundOptions) {
    this.youName = options.youName ?? 'You';
    this.partnerName = options.partnerName ?? 'Partner';
  }

  private json(res: ServerResponse, code: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  }

  private readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  async start(): Promise<{ url: string }> {
    this.emuYou = new EmulatorServer({ port: 0, host: '127.0.0.1', label: `${this.youName}'s bar` });
    this.emuPartner = new EmulatorServer({ port: 0, host: '127.0.0.1', label: `${this.partnerName}'s bar` });
    const you = await this.emuYou.start();
    const partner = await this.emuPartner.start();

    this.relay = new SyncServer({ port: 0, host: '127.0.0.1' });
    const { port: relayPort } = await this.relay.start();
    const syncUrl = `ws://127.0.0.1:${relayPort}`;

    const cfgYou = parseConfig({
      name: this.youName,
      partnerName: this.partnerName,
      bar: { addr: you.url },
      sync: { url: syncUrl, room: 'playground' },
      customStatuses: [{ id: 'recording', label: 'Recording', color: '#DC2626FF', alert: true }],
    });
    const cfgPartner = parseConfig({
      name: this.partnerName,
      partnerName: this.youName,
      bar: { addr: partner.url },
      sync: { url: syncUrl, room: 'playground' },
      customStatuses: [{ id: 'recording', label: 'Recording', color: '#DC2626FF', alert: true }],
    });

    this.appYou = new App(cfgYou, new DeviceBar(cfgYou.bar), () => {});
    this.appPartner = new App(cfgPartner, new DeviceBar(cfgPartner.bar), () => {});
    await this.appYou.start();
    await this.appPartner.start();

    const url = await this.startControlServer();
    return { url };
  }

  private agentFor(who: string): App | null {
    if (who === 'you') return this.appYou;
    if (who === 'partner') return this.appPartner;
    return null;
  }

  private startControlServer(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const path = url.pathname;
        const method = req.method ?? 'GET';

        if (method === 'GET' && (path === '/' || path === '/index.html')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(renderPlaygroundPage(this.youName, this.partnerName));
          return;
        }

        if (method === 'GET' && path === '/state') {
          return this.json(res, 200, {
            statuses: this.appYou.listStatuses(),
            you: { frame: this.emuYou.currentFrame(), snapshot: this.appYou.snapshot() },
            partner: { frame: this.emuPartner.currentFrame(), snapshot: this.appPartner.snapshot() },
          });
        }

        // POST /:who/status  or  /:who/pomodoro
        const m = /^\/(you|partner)\/(status|pomodoro)$/.exec(path);
        if (method === 'POST' && m) {
          const app = this.agentFor(m[1]!);
          if (!app) return this.json(res, 404, { ok: false, message: 'unknown agent' });
          void this.readBody(req).then((body) => {
            if (m[2] === 'status') {
              const id = String(body.id ?? '');
              return this.json(res, 200, app.setStatus(id));
            }
            const actions: Record<string, () => string> = {
              start: () => app.pomodoro_start(),
              pause: () => app.pomodoro_pause(),
              resume: () => app.pomodoro_resume(),
              stop: () => app.pomodoro_stop(),
              skip: () => app.pomodoro_skip(),
            };
            const fn = actions[String(body.action ?? '')];
            if (!fn) return this.json(res, 400, { ok: false, message: 'unknown action' });
            return this.json(res, 200, { ok: true, message: fn() });
          });
          return;
        }

        this.json(res, 404, { ok: false, message: 'not found' });
      });

      server.on('error', reject);
      server.listen(this.options.port, '127.0.0.1', () => {
        this.http = server;
        resolve(`http://127.0.0.1:${this.options.port}`);
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.http) return resolve();
      this.http.close(() => resolve());
    });
    await this.appYou?.stop();
    await this.appPartner?.stop();
    await this.relay?.stop();
    await this.emuYou?.stop();
    await this.emuPartner?.stop();
  }
}
