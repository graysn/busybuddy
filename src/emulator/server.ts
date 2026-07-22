import { createServer, type Server } from 'node:http';
import { renderPage } from './page.js';

/**
 * BUSY Bar emulator.
 *
 * Implements the subset of the device's HTTP API that BusyBuddy uses, so the
 * real `@busy-app/busy-lib` client can talk to it unchanged — point a config's
 * `bar.addr` at this server instead of a physical bar. It stores the latest
 * draw command and serves a browser page that renders the 72x16 screen.
 *
 * Endpoints (under `/api`, matching the device):
 *   GET    /api/version         → { api_semver } (client negotiates this first)
 *   POST   /api/display/draw    → store elements, return success
 *   DELETE /api/display/draw    → clear elements for an app
 *   GET    /api/status/system   → plausible status (not required, provided anyway)
 * Plus emulator-only helpers:
 *   GET    /                    → the viewer page
 *   GET    /frame               → current frame as JSON (polled by the page)
 */
export interface EmulatorOptions {
  port: number;
  host?: string;
  label?: string;
}

interface Frame {
  elements: unknown[];
  led: string | null;
  generation: number;
}

export class EmulatorServer {
  private server: Server | null = null;
  private frame: Frame = { elements: [], led: null, generation: 0 };
  private readonly label: string;

  constructor(private readonly options: EmulatorOptions) {
    this.label = options.label ?? 'BUSY Bar';
  }

  /** The most recent frame — handy for tests. */
  currentFrame(): Frame {
    return this.frame;
  }

  private json(res: import('node:http').ServerResponse, code: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  }

  start(): Promise<{ port: number; url: string }> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const path = url.pathname;
        const method = req.method ?? 'GET';

        // --- device API ---
        if (method === 'GET' && path === '/api/version') {
          return this.json(res, 200, { api_semver: '1.0.0', firmware_semver: '1.0.0-emulator' });
        }
        if (method === 'GET' && path === '/api/status/system') {
          return this.json(res, 200, { uptime: 0, charge: 100, model: 'emulator' });
        }
        if (method === 'POST' && path === '/api/display/draw') {
          let data = '';
          req.on('data', (c) => (data += c));
          req.on('end', () => {
            try {
              const body = JSON.parse(data) as { elements?: unknown[]; led_notification_color?: string };
              this.frame = {
                elements: Array.isArray(body.elements) ? body.elements : [],
                led: body.led_notification_color ?? null,
                generation: this.frame.generation + 1,
              };
              this.json(res, 200, { success: true });
            } catch {
              this.json(res, 400, { error: 'invalid draw body' });
            }
          });
          return;
        }
        if (method === 'DELETE' && path === '/api/display/draw') {
          this.frame = { elements: [], led: null, generation: this.frame.generation + 1 };
          return this.json(res, 200, { success: true });
        }

        // --- emulator viewer ---
        if (method === 'GET' && (path === '/' || path === '/index.html')) {
          const html = renderPage(this.label);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
        if (method === 'GET' && path === '/frame') {
          return this.json(res, 200, this.frame);
        }

        this.json(res, 404, { error: 'not found' });
      });

      server.on('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        this.server = server;
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.options.port;
        resolve({ port, url: `http://${this.options.host ?? '127.0.0.1'}:${port}` });
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }
}
