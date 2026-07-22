/**
 * Browser-side renderer for a BUSY Bar frame, shared by the standalone emulator
 * and the interactive playground.
 *
 * Legibility fix: instead of drawing onto a 72x16 canvas and upscaling with
 * `image-rendering: pixelated` (which turned 5-7px text into unreadable
 * blocks), we make the canvas high-resolution and scale the drawing context so
 * text is rendered crisply/antialiased at full size. The result reads clearly
 * while keeping the true 72x16 layout and proportions.
 *
 * Exposed as a string so it can be inlined into served HTML with no bundler.
 * (No template literals inside — keep it safe within this TS template string.)
 */
export const RENDER_SCRIPT = `
(function () {
  var FONT_PX = { tiny: 6, small: 7, condensed: 7, normal: 9, bold: 9, large: 12, extra_large: 15, global: 9 };
  var SANS = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  var MONO = "'SF Mono', 'Roboto Mono', Menlo, monospace";

  function css(color) {
    if (!color) return 'rgba(0,0,0,0)';
    var h = color.replace('#', '');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    var a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function fmtCountdown(el) {
    var now = Date.now();
    var target = Number(el.timestamp) * 1000;
    var secs = el.direction === 'time_since' ? (now - target) / 1000 : (target - now) / 1000;
    secs = Math.max(0, Math.floor(secs));
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    function pad(n) { return String(n).padStart(2, '0'); }
    if (el.show_hours === 'always' || h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
  }

  function drawText(ctx, str, el, px, color, fam, nowMs) {
    ctx.font = px + 'px ' + fam;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    var width = el.width || 72;
    var yMid = el.y + px / 2;
    var textW = ctx.measureText(str).width;
    if (el.scroll_rate && textW > width) {
      var speed = el.scroll_rate / 60;
      var gap = 10;
      var period = (textW + gap) / speed;
      var t = (nowMs / 1000) % period;
      var ox = el.x - t * speed;
      ctx.save();
      ctx.beginPath();
      ctx.rect(el.x, 0, width, 16);
      ctx.clip();
      ctx.fillText(str, ox, yMid);
      ctx.fillText(str, ox + textW + gap, yMid);
      ctx.restore();
    } else {
      ctx.fillText(str, el.x, yMid);
    }
  }

  function draw(ctx, frame, nowMs) {
    ctx.clearRect(0, 0, 72, 16);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 72, 16);
    var els = (frame && frame.elements) || [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === 'rectangle') {
        var colors = el.fill_colors || ['#FFFFFFFF'];
        if (el.fill === 'gradient_h' || el.fill === 'gradient_v') {
          var g = el.fill === 'gradient_h'
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
        drawText(ctx, el.text || '', el, FONT_PX[el.font] || 8, css(el.color), SANS, nowMs);
      } else if (el.type === 'countdown') {
        var cel = Object.assign({}, el, { width: 34 });
        drawText(ctx, fmtCountdown(el), cel, FONT_PX.normal, css(el.color), MONO, nowMs);
      } else if (el.type === 'image' || el.type === 'animation') {
        ctx.fillStyle = 'rgba(148,163,184,.4)';
        ctx.fillRect(el.x, el.y, 10, 10);
      }
    }
    // LED alert: blink an inset border in the notification color.
    if (frame && frame.led) {
      var on = Math.floor(nowMs / 350) % 2 === 0;
      if (on) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = css(frame.led);
        ctx.strokeRect(0.5, 0.5, 71, 15);
      }
    }
  }

  window.BusyBar = {
    attach: function (canvas, opts) {
      var scale = (opts && opts.scale) || 14;
      canvas.width = 72 * scale;
      canvas.height = 16 * scale;
      canvas.style.width = (72 * scale) + 'px';
      canvas.style.height = (16 * scale) + 'px';
      var ctx = canvas.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      var state = { frame: { elements: [], led: null } };
      function loop(now) {
        draw(ctx, state.frame, now);
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
      return { setFrame: function (f) { state.frame = f || { elements: [], led: null }; } };
    }
  };
})();
`;
