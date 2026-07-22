/**
 * `npm run demo:visual` — the full real stack in one process, rendered in your
 * browser. Starts two BUSY Bar emulators, the sync relay, and two agents whose
 * bars are the emulators (driven over real HTTP via @busy-app/busy-lib), then
 * loops a short scene. Open the two printed URLs side by side to watch both
 * bars react to each other. Ctrl+C to stop.
 */
import { EmulatorServer } from '../src/emulator/server.js';
import { SyncServer } from '../src/sync/server.js';
import { App } from '../src/app.js';
import { DeviceBar } from '../src/bar.js';
import { parseConfig } from '../src/config.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BOLD = '\x1b[1m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const narrate = (s: string) => console.log(`${BOLD}${YELLOW}▶ ${s}${RESET}`);

async function main(): Promise<void> {
  const emuA = new EmulatorServer({ port: 10420, host: '127.0.0.1', label: "Grayson's bar" });
  const emuB = new EmulatorServer({ port: 10421, host: '127.0.0.1', label: "Partner's bar" });
  const a = await emuA.start();
  const b = await emuB.start();

  const relay = new SyncServer({ port: 8787, host: '127.0.0.1' });
  await relay.start();

  const graysonCfg = parseConfig({
    name: 'Grayson',
    partnerName: 'Partner',
    bar: { addr: a.url },
    sync: { url: 'ws://127.0.0.1:8787', room: 'visual' },
    customStatuses: [{ id: 'recording', label: 'Recording', color: '#DC2626FF', alert: true }],
  });
  const partnerCfg = parseConfig({
    name: 'Partner',
    partnerName: 'Grayson',
    bar: { addr: b.url },
    sync: { url: 'ws://127.0.0.1:8787', room: 'visual' },
  });

  const grayson = new App(graysonCfg, new DeviceBar(graysonCfg.bar), () => {});
  const partner = new App(partnerCfg, new DeviceBar(partnerCfg.bar), () => {});
  await grayson.start();
  await partner.start();

  console.log(`\n${BOLD}Open these two in your browser, side by side:${RESET}`);
  console.log(`  ${a.url}   (Grayson's bar)`);
  console.log(`  ${b.url}   (Partner's bar)`);
  console.log(`\n${BOLD}Looping a scene — Ctrl+C to stop.${RESET}\n`);

  let stop = false;
  const shutdown = async () => {
    stop = true;
    await grayson.stop();
    await partner.stop();
    await relay.stop();
    await emuA.stop();
    await emuB.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // Loop the scene so the browser tabs always show motion.
  while (!stop) {
    narrate('Both available');
    grayson.setStatus('available');
    partner.setStatus('available');
    await sleep(3500);

    narrate('Grayson starts recording — Partner\'s bar flashes red');
    grayson.setStatus('recording');
    await sleep(4000);

    narrate('Partner starts a Pomodoro focus session — live countdown');
    partner.pomodoro_start();
    await sleep(4000);

    narrate('Grayson joins a meeting');
    grayson.setStatus('meeting');
    await sleep(4000);

    narrate('Reset');
    partner.pomodoro_stop();
    await sleep(2000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
