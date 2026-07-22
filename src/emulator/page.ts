import { RENDER_SCRIPT } from './render-client.js';

/**
 * The emulator's browser page: a crisp, scaled-up view of the 72x16 BUSY Bar
 * screen that polls the emulator for the latest draw command and renders it.
 * Fonts/scrolling/countdown are approximated — this is for reading layout,
 * color, timers and LED alerts, not a pixel-perfect device replica.
 */
export function renderPage(label: string): string {
  const safeLabel = label.replace(/[<>&]/g, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BusyBuddy emulator — ${safeLabel}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0f19; color: #cbd5e1; font: 14px/1.4 -apple-system, system-ui, sans-serif;
         display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 28px 16px; }
  h1 { font-size: 15px; font-weight: 600; margin: 0; color: #e2e8f0; letter-spacing: .02em; }
  .sub { font-size: 12px; color: #64748b; margin-top: -8px; }
  .bezel { background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 18px;
           box-shadow: 0 10px 40px rgba(0,0,0,.5); }
  canvas { display: block; border-radius: 4px; background: #000; }
  .status { font-size: 12px; color: #475569; }
  .status.live { color: #22c55e; }
</style>
</head>
<body>
  <h1>${safeLabel}</h1>
  <div class="sub">BUSY Bar emulator · 72 × 16 · front display</div>
  <div class="bezel"><canvas id="screen"></canvas></div>
  <div class="status" id="status">connecting…</div>
<script>${RENDER_SCRIPT}</script>
<script>
  var view = window.BusyBar.attach(document.getElementById('screen'), { scale: 14 });
  var statusEl = document.getElementById('status');
  async function poll() {
    try {
      var res = await fetch('/frame', { cache: 'no-store' });
      var frame = await res.json();
      view.setFrame(frame);
      statusEl.textContent = frame.elements.length ? 'live' : 'screen cleared';
      statusEl.className = 'status live';
    } catch (e) {
      statusEl.textContent = 'emulator offline';
      statusEl.className = 'status';
    }
  }
  poll();
  setInterval(poll, 250);
</script>
</body>
</html>`;
}
