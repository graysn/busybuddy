import { RENDER_SCRIPT } from '../emulator/render-client.js';

/**
 * The playground control panel: two bar previews (one per person) with a live
 * status readout and buttons to drive each side. Polls /state and posts
 * commands to the playground server.
 */
export function renderPlaygroundPage(youName: string, partnerName: string): string {
  const y = youName.replace(/[<>&]/g, '');
  const p = partnerName.replace(/[<>&]/g, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BusyBuddy playground</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0f19; color: #cbd5e1;
         font: 14px/1.45 -apple-system, system-ui, Segoe UI, Roboto, sans-serif; padding: 24px 16px 60px; }
  header { max-width: 900px; margin: 0 auto 20px; }
  h1 { font-size: 18px; margin: 0 0 4px; color: #f1f5f9; }
  header p { margin: 0; color: #64748b; font-size: 13px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 900px; margin: 0 auto; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  .panel { background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 16px; }
  .panel h2 { font-size: 15px; margin: 0 0 2px; display: flex; align-items: center; gap: 8px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #475569; display: inline-block; }
  .dot.online { background: #22c55e; } .dot.stale { background: #f59e0b; } .dot.offline { background: #64748b; }
  .presence { font-size: 12px; color: #64748b; font-weight: 400; }
  .bezel { background: #000; border-radius: 8px; padding: 10px; margin: 10px 0; display: flex; justify-content: center; }
  canvas { display: block; border-radius: 3px; }
  .readout { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 8px 0; min-height: 20px; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; border: 1px solid #334155; }
  .pomo { font-size: 12px; color: #94a3b8; margin: 4px 0 10px; min-height: 16px; font-variant-numeric: tabular-nums; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; margin: 12px 0 6px; }
  .btns { display: flex; flex-wrap: wrap; gap: 6px; }
  button { font: inherit; font-size: 12px; padding: 5px 9px; border-radius: 7px; cursor: pointer;
           background: #1e293b; color: #cbd5e1; border: 1px solid #334155; transition: .1s; }
  button:hover { background: #273449; }
  button.active { border-color: #3b82f6; background: #1e3a5f; color: #fff; }
  .pomo-btns button { background: #172033; }
</style>
</head>
<body>
<header>
  <h1>BusyBuddy playground</h1>
  <p>Each panel is one person's bar (their status on the left card, their partner on the right). Drive either side and watch both bars react — this is the live app, not a scripted demo.</p>
</header>
<div class="grid">
  <div class="panel" data-who="you">
    <h2><span class="dot" id="you-dot"></span>${y}'s bar <span class="presence" id="you-presence"></span></h2>
    <div class="bezel"><canvas id="you-canvas"></canvas></div>
    <div class="readout"><span class="swatch" id="you-swatch"></span><span id="you-status">—</span></div>
    <div class="pomo" id="you-pomo"></div>
    <div class="label">${y}'s status</div>
    <div class="btns" id="you-statuses"></div>
    <div class="label">${y}'s Pomodoro</div>
    <div class="btns pomo-btns" id="you-pomo-btns"></div>
  </div>
  <div class="panel" data-who="partner">
    <h2><span class="dot" id="partner-dot"></span>${p}'s bar <span class="presence" id="partner-presence"></span></h2>
    <div class="bezel"><canvas id="partner-canvas"></canvas></div>
    <div class="readout"><span class="swatch" id="partner-swatch"></span><span id="partner-status">—</span></div>
    <div class="pomo" id="partner-pomo"></div>
    <div class="label">${p}'s status</div>
    <div class="btns" id="partner-statuses"></div>
    <div class="label">${p}'s Pomodoro</div>
    <div class="btns pomo-btns" id="partner-pomo-btns"></div>
  </div>
</div>
<script>${RENDER_SCRIPT}</script>
<script>
  var SCALE = 11;
  var views = {
    you: window.BusyBar.attach(document.getElementById('you-canvas'), { scale: SCALE }),
    partner: window.BusyBar.attach(document.getElementById('partner-canvas'), { scale: SCALE })
  };
  var POMO = [['start','Start'],['pause','Pause'],['resume','Resume'],['skip','Skip'],['stop','Stop']];
  var builtButtons = false;

  async function post(who, kind, payload) {
    await fetch('/' + who + '/' + kind, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    poll();
  }

  function buildButtons(statuses) {
    ['you','partner'].forEach(function (who) {
      var sc = document.getElementById(who + '-statuses');
      statuses.forEach(function (s) {
        var b = document.createElement('button');
        b.textContent = s.label;
        b.dataset.id = s.id;
        b.onclick = function () { post(who, 'status', { id: s.id }); };
        sc.appendChild(b);
      });
      var pc = document.getElementById(who + '-pomo-btns');
      POMO.forEach(function (pair) {
        var b = document.createElement('button');
        b.textContent = pair[1];
        b.onclick = function () { post(who, 'pomodoro', { action: pair[0] }); };
        pc.appendChild(b);
      });
    });
    builtButtons = true;
  }

  function fmtTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function updatePanel(who, data) {
    views[who].setFrame(data.frame);
    var snap = data.snapshot;
    var st = snap.me.state;
    document.getElementById(who + '-status').textContent = st.label;
    document.getElementById(who + '-swatch').style.background = '#' + st.color.slice(1, 7);
    var pomo = snap.pomodoro;
    document.getElementById(who + '-pomo').textContent =
      pomo.phase === 'idle' ? '' :
      (pomo.phase.replace('_', ' ') + ' · ' + fmtTime(pomo.remainingMs) + (pomo.running ? ' ▶' : ' ⏸'));
    // partner presence shown on this person's panel = do THEY see their partner?
    var pres = snap.partner.presence;
    document.getElementById(who + '-dot').className = 'dot ' + pres;
    document.getElementById(who + '-presence').textContent = 'sees partner: ' + pres;
    // highlight active status button
    var sc = document.getElementById(who + '-statuses');
    Array.prototype.forEach.call(sc.children, function (b) {
      b.classList.toggle('active', b.dataset.id === snap.baseStatusId);
    });
  }

  async function poll() {
    try {
      var res = await fetch('/state', { cache: 'no-store' });
      var state = await res.json();
      if (!builtButtons) buildButtons(state.statuses);
      updatePanel('you', state.you);
      updatePanel('partner', state.partner);
    } catch (e) { /* keep trying */ }
  }
  poll();
  setInterval(poll, 400);
</script>
</body>
</html>`;
}
