import { createServer, type Server } from 'node:http';
import type { App } from './app.js';

/**
 * Tiny local control API (loopback only). The long-running `busybuddy run`
 * agent hosts it; one-shot commands like `busybuddy set focus` POST to it so
 * you can drive the running agent from another terminal or a shortcut.
 */
export function startControlServer(app: App, port: number, log: (line: string) => void): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    const readBody = (): Promise<unknown> =>
      new Promise((resolve) => {
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

    (async () => {
      if (req.method === 'GET' && url.pathname === '/snapshot') return send(200, app.snapshot());
      if (req.method === 'GET' && url.pathname === '/statuses') return send(200, app.listStatuses());
      if (req.method === 'POST' && url.pathname === '/status') {
        const body = (await readBody()) as { id?: string };
        if (!body.id) return send(400, { ok: false, message: 'missing id' });
        const result = app.setStatus(body.id);
        return send(result.ok ? 200 : 400, result);
      }
      if (req.method === 'POST' && url.pathname === '/pomodoro') {
        const body = (await readBody()) as { action?: string };
        const map: Record<string, () => string> = {
          start: () => app.pomodoro_start(),
          pause: () => app.pomodoro_pause(),
          resume: () => app.pomodoro_resume(),
          stop: () => app.pomodoro_stop(),
          skip: () => app.pomodoro_skip(),
        };
        const fn = body.action ? map[body.action] : undefined;
        if (!fn) return send(400, { ok: false, message: `unknown action "${body.action}"` });
        return send(200, { ok: true, message: fn() });
      }
      send(404, { ok: false, message: 'not found' });
    })().catch((err) => send(500, { ok: false, message: (err as Error).message }));
  });

  server.listen(port, '127.0.0.1', () => log(`[control] listening on http://127.0.0.1:${port}`));
  return server;
}

/** Client helper used by one-shot CLI commands. */
export async function controlRequest(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
