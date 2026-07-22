#!/usr/bin/env node
import { loadConfig } from './config.js';
import { App } from './app.js';
import { createBar } from './bar.js';
import { SyncServer } from './sync/server.js';
import { EmulatorServer } from './emulator/server.js';
import { Playground } from './playground/server.js';
import { startControlServer, controlRequest } from './control.js';

/** Minimal flag parser: returns { _: positionals, ...flags } with string/boolean values. */
function parseArgs(argv: string[]): { _: string[]; flags: Record<string, string | boolean> } {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

function resolveControlPort(flags: Record<string, string | boolean>): number {
  if (typeof flags.port === 'string') return Number(flags.port);
  try {
    return loadConfig(typeof flags.config === 'string' ? flags.config : undefined).controlPort;
  } catch {
    return 8788;
  }
}

const HELP = `busybuddy — sync two BUSY Bars so you and your partner see each other's status

Usage:
  busybuddy serve [--port 8787] [--host 0.0.0.0]   Run the sync relay
  busybuddy emulate [--port 10420] [--label name]  Run a browser BUSY Bar emulator
  busybuddy playground [--port 8080]               Interactive two-bar test panel in your browser
  busybuddy run [--config path] [--dry-run] [--watch]  Run your bar agent (long-running)
                                                   (--watch: drive status from the bar's own controls)
  busybuddy set <status-id> [--port]               Change your status
  busybuddy pomodoro <start|pause|resume|stop|skip> [--port]
  busybuddy status [--port]                        Show current snapshot
  busybuddy statuses [--port]                      List available statuses
  busybuddy help

Config is read from ./busybuddy.config.json (see busybuddy.config.example.json).
Secrets/connection can be overridden with env vars:
  BUSYBUDDY_BAR_ADDR, BUSYBUDDY_BAR_TOKEN, BUSYBUDDY_BAR_PASSWORD,
  BUSYBUDDY_SYNC_URL, BUSYBUDDY_ROOM
`;

async function cmdServe(flags: Record<string, string | boolean>): Promise<void> {
  const port = typeof flags.port === 'string' ? Number(flags.port) : 8787;
  const host = typeof flags.host === 'string' ? flags.host : undefined;
  const server = new SyncServer({ port, host });
  const { port: bound } = await server.start();
  console.log(`[relay] BusyBuddy sync relay listening on ws://${host ?? '0.0.0.0'}:${bound}`);
  console.log('[relay] Point both agents at this URL via sync.url / BUSYBUDDY_SYNC_URL.');
  const shutdown = () => {
    console.log('\n[relay] shutting down');
    void server.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function cmdEmulate(flags: Record<string, string | boolean>): Promise<void> {
  const port = typeof flags.port === 'string' ? Number(flags.port) : 10420;
  const label = typeof flags.label === 'string' ? flags.label : 'BUSY Bar (emulator)';
  const server = new EmulatorServer({ port, host: '127.0.0.1', label });
  const { url } = await server.start();
  console.log(`[emulator] "${label}" running`);
  console.log(`[emulator] open ${url} in your browser to see the screen`);
  console.log(`[emulator] point an agent at it with  bar.addr = "${url}"`);
  const shutdown = () => void server.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function cmdPlayground(flags: Record<string, string | boolean>): Promise<void> {
  const port = typeof flags.port === 'string' ? Number(flags.port) : 8080;
  const youName = typeof flags.you === 'string' ? flags.you : 'You';
  const partnerName = typeof flags.partner === 'string' ? flags.partner : 'Partner';
  const pg = new Playground({ port, youName, partnerName });
  const { url } = await pg.start();
  console.log(`[playground] open ${url} in your browser`);
  console.log('[playground] drive either bar and watch both react. Ctrl+C to stop.');
  const shutdown = () => void pg.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function cmdRun(flags: Record<string, string | boolean>): Promise<void> {
  const cfg = loadConfig(typeof flags.config === 'string' ? flags.config : undefined);
  if (flags.watch === true) cfg.bar.watch = true;
  const dryRun = flags['dry-run'] === true;
  const bar = createBar(cfg, dryRun, (l) => console.log(l));
  const app = new App(cfg, bar, (l) => console.log(l));
  await app.start();
  const control = startControlServer(app, cfg.controlPort, (l) => console.log(l));

  enableKeyboard(app);

  const shutdown = async () => {
    console.log('\n[app] shutting down');
    control.close();
    await app.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

function enableKeyboard(app: App): void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return;
  const statuses = app.listStatuses();
  console.log('\nKeyboard controls:');
  statuses.slice(0, 9).forEach((s, i) => console.log(`  ${i + 1}  ${s.label}`));
  console.log('  p  start / pause Pomodoro     k  skip phase');
  console.log('  x  stop Pomodoro              q  quit\n');

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  stdin.on('data', (key: string) => {
    if (key === 'q' || key === '') {
      process.emit('SIGINT');
      return;
    }
    if (key >= '1' && key <= '9') {
      const def = statuses[Number(key) - 1];
      if (def) console.log(`[key] ${app.setStatus(def.id).message}`);
      return;
    }
    if (key === 'p') {
      const snap = app.snapshot().pomodoro;
      console.log(`[key] ${snap.running ? app.pomodoro_pause() : app.pomodoro_start()}`);
    } else if (key === 'k') {
      console.log(`[key] ${app.pomodoro_skip()}`);
    } else if (key === 'x') {
      console.log(`[key] ${app.pomodoro_stop()}`);
    }
  });
}

async function cmdSet(positionals: string[], flags: Record<string, string | boolean>): Promise<void> {
  const id = positionals[0];
  if (!id) {
    console.error('usage: busybuddy set <status-id>');
    process.exit(1);
  }
  const { status, json } = await controlRequest(resolveControlPort(flags), 'POST', '/status', { id });
  console.log((json as { message?: string }).message ?? JSON.stringify(json));
  if (status >= 400) process.exit(1);
}

async function cmdPomodoro(positionals: string[], flags: Record<string, string | boolean>): Promise<void> {
  const action = positionals[0];
  if (!action) {
    console.error('usage: busybuddy pomodoro <start|pause|resume|stop|skip>');
    process.exit(1);
  }
  const { status, json } = await controlRequest(resolveControlPort(flags), 'POST', '/pomodoro', { action });
  console.log((json as { message?: string }).message ?? JSON.stringify(json));
  if (status >= 400) process.exit(1);
}

async function cmdStatus(flags: Record<string, string | boolean>): Promise<void> {
  const { json } = await controlRequest(resolveControlPort(flags), 'GET', '/snapshot');
  const snap = json as {
    me?: { name: string; state: { label: string; color: string } };
    partner?: { name: string; presence: string; state?: { label: string } | null };
    pomodoro?: { phase: string; running: boolean; remainingMs: number };
    connected?: boolean;
  };
  if (!snap.me) {
    console.log('No running agent found. Start one with `busybuddy run`.');
    return;
  }
  const mins = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  console.log(`You (${snap.me.name}): ${snap.me.state.label} [${snap.me.state.color}]`);
  console.log(
    `Partner (${snap.partner?.name}): ${snap.partner?.presence}` +
      (snap.partner?.state ? ` — ${snap.partner.state.label}` : ''),
  );
  if (snap.pomodoro && snap.pomodoro.phase !== 'idle') {
    console.log(
      `Pomodoro: ${snap.pomodoro.phase} ${snap.pomodoro.running ? '▶' : '⏸'} ${mins(snap.pomodoro.remainingMs)}`,
    );
  }
  console.log(`Relay: ${snap.connected ? 'connected' : 'disconnected'}`);
}

async function cmdStatuses(flags: Record<string, string | boolean>): Promise<void> {
  const { json } = await controlRequest(resolveControlPort(flags), 'GET', '/statuses');
  for (const s of json as Array<{ id: string; label: string; color: string }>) {
    console.log(`  ${s.id.padEnd(12)} ${s.label.padEnd(16)} ${s.color}`);
  }
}

async function main(): Promise<void> {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = _;
  try {
    switch (command) {
      case 'serve':
        return await cmdServe(flags);
      case 'emulate':
        return await cmdEmulate(flags);
      case 'playground':
        return await cmdPlayground(flags);
      case 'run':
        return await cmdRun(flags);
      case 'set':
        return await cmdSet(rest, flags);
      case 'pomodoro':
        return await cmdPomodoro(rest, flags);
      case 'status':
        return await cmdStatus(flags);
      case 'statuses':
        return await cmdStatuses(flags);
      case 'help':
      case undefined:
        console.log(HELP);
        return;
      default:
        console.error(`Unknown command: ${command}\n`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

void main();
