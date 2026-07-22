/**
 * The emulator's browser page: a scaled-up view of the 72x16 BUSY Bar screen
 * that polls the emulator for the latest draw command and renders it on a
 * canvas. Fonts/scrolling/countdown are approximated — this is for seeing
 * layout, color, timers and LED alerts, not a pixel-perfect device replica.
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
           box-shadow: 0 10px 40px rgba(0,0,0,.5); position: relative; }
  canvas { display: block; image-rendering: pixelated; border-radius: 4px; background: #000; }
  .led { position: absolute; inset: 6px; border-radius: 12px; pointer-events: none; box-shadow: none; transition: box-shadow .05s; }
  .status { font-size: 12px; color: #475569; }
  .status.live { color: #22c55e; }
</style>
</head>
<body>
  <h1>${safeLabel}</h1>
  <div class="sub">BUSY Bar emulator · 72 × 16 · front display</div>
  <div class="bezel">
    <canvas id="screen" width="72" height="16"></canvas>
    <div class="led" id="led"></div>
  </div>
  <div class="status" id="status">connecting…</div>
<script>
const SCALE = 12;
const canvas = document.getElementById('screen');
canvas.style.width = (72 * SCALE) + 'px';
canvas.style.height = (16 * SCALE) + 'px';
const ctx = canvas.getContext('2d');
const led = document.getElementById('led');
const statusEl = document.getElementById('status');

let frame = { elements: [], led: null, generation: -1 };

const FONT_PX = { tiny: 5, small: 6, condensed: 6, normal: 8, bold: 8, large: 11, extra_large: 14, global: 8 };

function css(color) {
  // #RRGGBB or #RRGGBBAA -> rgba()
  if (!color) return 'rgba(0,0,0,0)';
  const h = color.replace('#', '');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  const a = h.length >= 8 ? parseInt(h.slice(6,8),16)/255 : 1;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

function fmtCountdown(el) {
  const now = Date.now();
  const target = Number(el.timestamp) * 1000;
  let secs = el.direction === 'time_since' ? (now - target) / 1000 : (target - now) / 1000;
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (el.show_hours === 'always' || h > 0) return h + ':' + pad(m) + ':' + pad(s);
  return m + ':' + pad(s);
}

function drawText(str, el, px, color) {
  ctx.font = px + 'px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  const width = el.width || 72;
  const textW = ctx.measureText(str).width;
  let ox = el.x;
  if (el.scroll_rate && textW > width) {
    // Scroll leftwards, looping with a gap.
    const speed = el.scroll_rate / 60; // px per second
    const gap = 8;
    const period = (textW + gap) / speed;
    const t = (performance.now() / 1000) % period;
    ox = el.x - t * speed;
    ctx.save();
    ctx.beginPath();
    ctx.rect(el.x, 0, width, 16);
    ctx.clip();
    ctx.fillText(str, ox, el.y);
    ctx.fillText(str, ox + textW + gap, el.y);
    ctx.restore();
  } else {
    ctx.fillText(str, ox, el.y);
  }
}

function render() {
  ctx.clearRect(0, 0, 72, 16);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 72, 16);

  for (const el of frame.elements) {
    if (el.type === 'rectangle') {
      const colors = el.fill_colors || ['#FFFFFFFF'];
      if (el.fill === 'gradient_h' || el.fill === 'gradient_v') {
        const g = el.fill === 'gradient_h'
          ? ctx.createLinearGradient(el.x, 0, el.x + el.width, 0)
          : ctx.createLinearGradient(0, el.y, 0, el.y + el.height);
        g.addColorStop(0, css(colors[0]));
        g.addColorStop(1, css(colors[1] || colors[0]));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = css(colors[0]);
      }
      if (el.fill !== 'none') ctx.fillRect(el.x, el.y, el.width, el.height);
      if (el.border_width > 0) {
        ctx.lineWidth = el.border_width;
        ctx.strokeStyle = css(el.border_color);
        ctx.strokeRect(el.x + 0.5, el.y + 0.5, el.width - 1, el.height - 1);
      }
    } else if (el.type === 'text') {
      drawText(el.text || '', el, FONT_PX[el.font] || 7, css(el.color));
    } else if (el.type === 'countdown') {
      drawText(fmtCountdown(el), { ...el, width: 34 }, FONT_PX.small, css(el.color));
    } else if (el.type === 'image' || el.type === 'animation') {
      ctx.fillStyle = 'rgba(148,163,184,.4)';
      ctx.fillRect(el.x, el.y, 10, 10);
    }
  }

  // LED alert: blink an inset border in the notification color.
  if (frame.led) {
    const on = Math.floor(performance.now() / 350) % 2 === 0;
    led.style.boxShadow = on ? '0 0 0 2px ' + css(frame.led) + ', 0 0 18px ' + css(frame.led) : 'none';
  } else {
    led.style.boxShadow = 'none';
  }

  requestAnimationFrame(render);
}
requestAnimationFrame(render);

async function poll() {
  try {
    const res = await fetch('/frame', { cache: 'no-store' });
    frame = await res.json();
    statusEl.textContent = frame.elements.length ? 'live' : 'screen cleared';
    statusEl.className = 'status live';
  } catch {
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
