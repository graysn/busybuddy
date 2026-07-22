/**
 * `npm run demo` — spin up the sync relay and two dry-run agents in one process
 * and play out a short scene, so you can watch BusyBuddy work end-to-end without
 * any hardware or manual terminal juggling.
 *
 * It uses the exact same building blocks the CLI wires together (SyncServer,
 * App, MockBar), so it's a real integration run, not a mock-up. Each agent's
 * rendered frames are printed with a colored prefix.
 */
import { SyncServer } from '../src/sync/server.js';
import { App } from '../src/app.js';
import { MockBar } from '../src/bar.js';
import { parseConfig } from '../src/config.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const YELLOW = '\x1b[33m';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function prefixed(color: string, tag: string) {
  return (line: string) => console.log(`${color}${tag}${RESET} ${line}`);
}

function narrate(line: string) {
  console.log(`\n${BOLD}${YELLOW}▶ ${line}${RESET}`);
}

async function main(): Promise<void> {
  console.log(`${BOLD}BusyBuddy demo${RESET} ${DIM}— relay + two dry-run agents in one process${RESET}`);

  // 1. Relay on an ephemeral port.
  const server = new SyncServer({ port: 0, host: '127.0.0.1' });
  const { port } = await server.start();
  const url = `ws://127.0.0.1:${port}`;
  console.log(`${DIM}relay listening on ${url}${RESET}`);

  // 2. Two agents in the same room, each drawing to a MockBar (ASCII preview).
  const graysonCfg = parseConfig({
    name: 'Grayson',
    partnerName: 'Erik',
    sync: { url, room: 'demo' },
    customStatuses: [{ id: 'recording', label: 'Recording', color: '#DC2626FF', alert: true }],
  });
  const erikCfg = parseConfig({
    name: 'Erik',
    partnerName: 'Grayson',
    sync: { url, room: 'demo' },
  });

  const grayson = new App(graysonCfg, new MockBar(prefixed(CYAN, 'Grayson')), prefixed(CYAN, 'Grayson'));
  const erik = new App(erikCfg, new MockBar(prefixed(MAGENTA, '   Erik')), prefixed(MAGENTA, '   Erik'));

  await grayson.start();
  await erik.start();
  await sleep(800); // let them discover each other

  narrate('Both are Available. Each bar shows two cards: "me" and "partner".');
  await sleep(1200);

  narrate('Grayson starts recording a video — Erik\'s bar should flash red (LED alert).');
  grayson.setStatus('recording');
  await sleep(1500);

  narrate('Erik starts a Pomodoro focus session — Grayson sees Erik\'s live countdown.');
  erik.pomodoro_start();
  await sleep(1500);

  narrate('Grayson finishes recording and goes into a meeting.');
  grayson.setStatus('meeting');
  await sleep(1500);

  narrate('Erik pauses the timer to grab coffee.');
  erik.pomodoro_pause();
  await sleep(1500);

  narrate('Done. Tearing everything down.');
  await grayson.stop();
  await erik.stop();
  await server.stop();
  await sleep(200);
  console.log(`\n${BOLD}${YELLOW}✔ demo complete${RESET} ${DIM}— run the same thing for real with three terminals; see the README.${RESET}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
