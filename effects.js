// Işık efekti önizlemesi: tuşların altına yumuşak bir ışık katmanı çizer.
// Tek canvas, 30 fps sınırı; sayfa gizliyken ya da efekt sabitken çizim durur.

const CODE_TO_KEY = {
  Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', PageUp: 'PgUp', CapsLock: 'CapsLock', Semicolon: ';', Quote: "'",
  Enter: 'Enter', PageDown: 'PgDn', ShiftLeft: 'LShift', Comma: ',', Period: '.', Slash: '/', ShiftRight: 'RShift',
  ArrowUp: 'Up', End: 'End', ControlLeft: 'LCtrl', MetaLeft: 'LWin', AltLeft: 'LAlt', Space: 'Space', ControlRight: 'RCtrl',
  ArrowLeft: 'Left', ArrowDown: 'Down', ArrowRight: 'Right', IntlBackslash: 'LShift',
};
function keyFromEvent(e) {
  if (CODE_TO_KEY[e.code]) return CODE_TO_KEY[e.code];
  let m = /^Key([A-Z])$/.exec(e.code); if (m) return m[1];
  m = /^Digit(\d)$/.exec(e.code); if (m) return m[1];
  m = /^F(\d{1,2})$/.exec(e.code); if (m && +m[1] <= 12) return 'F' + m[1];
  return null;
}

function hsv(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60;
  const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), r = v * (1 - s * (1 - f));
  const [R, G, B] = [[v, r, p], [q, v, p], [p, v, r], [p, q, v], [r, p, v], [v, p, q]][i % 6];
  return [R * 255, G * 255, B * 255];
}
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

class LedPreview {
  constructor(board) {
    this.board = board;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'glow';
    this.ctx = this.canvas.getContext('2d');
    this.keys = F75.filter((k) => !k.knob);
    this.byName = Object.fromEntries(this.keys.map((k) => [k.n, k]));
    this.snake = [...this.keys].sort((a, b) => (a.y - b.y) || ((Math.round(a.y) % 2 ? -1 : 1) * (a.x - b.x)));
    this.presses = [];
    this.lastReal = 0;
    this.nextSim = 0;
    this.drops = [];
    this.state = { effect: 0 };
    this.running = false;
    this.raf = 0;
    this.last = 0;
    document.addEventListener('visibilitychange', () => this.kick());
  }
  attach() {
    if (this.canvas.parentNode !== this.board) this.board.prepend(this.canvas);
    this.resize();
  }
  resize() {
    const r = this.board.getBoundingClientRect();
    const k = 0.5; // bulanık çizim için yarım çözünürlük yeter
    this.canvas.width = Math.max(1, Math.round(r.width * k));
    this.canvas.height = Math.max(1, Math.round(r.height * k));
  }
  set(state) { this.state = state; this.kick(); }
  press(name) {
    const k = this.byName[name];
    if (!k) return;
    const now = performance.now() / 1000;
    this.presses.push({ k, t0: now, hue: Math.random() * 360 });
    this.lastReal = now;
    if (this.presses.length > 40) this.presses.shift();
    this.kick();
  }
  animated() {
    const e = this.state.effect;
    return this.state.visible && !document.hidden && e !== 0 && e !== 1 && e !== CUSTOM_EFFECT;
  }
  kick() {
    if (!this.state.visible) { this.stop(); return; }
    this.draw(performance.now());
    if (this.animated() && !this.running) {
      this.running = true;
      const loop = (ts) => {
        if (!this.animated()) { this.running = false; return; }
        if (ts - this.last >= 33) { this.last = ts; this.draw(ts); }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }
  }
  stop() { cancelAnimationFrame(this.raf); this.running = false; }

  color(k, T, now) {
    const s = this.state, e = s.effect, base = s.color || [255, 255, 255];
    const hueX = (k.cx / 16) * 360;
    const pick = (h) => (s.colorful ? hsv(h, 1, 1) : base);
    switch (e) {
      case 1: return pick(hueX);
      case 2: return scale(s.colorful ? hsv(T * 40, 1, 1) : base, (1 - Math.cos(T * 2.2)) / 2);
      case 3: return hsv(hueX - T * 90, 1, 1);
      case 4: case 12: {
        const life = e === 4 ? 1.6 : 0.7;
        let best = 0, h = 0;
        for (const p of this.presses) if (p.k === k) { const v = 1 - (now - p.t0) / life; if (v > best) { best = v; h = p.hue; } }
        return best > 0 ? scale(s.colorful ? hsv(h, 1, 1) : base, best) : null;
      }
      case 5: case 8: {
        let best = 0, h = 0;
        for (const d of this.drops) if (d.k === k) { const v = e === 8 ? Math.sin(Math.min(1, (now - d.t0) / 1.2) * Math.PI) : 1 - (now - d.t0) / 0.9; if (v > best) { best = v; h = d.hue; } }
        return best > 0 ? scale(s.colorful ? hsv(h, 1, 1) : base, best) : null;
      }
      case 7: {
        let best = 0, h = 0;
        for (const p of this.presses) {
          const age = now - p.t0, r = age * 7, dist = Math.hypot(k.cx - p.k.cx, (k.cy - p.k.cy) * 1.1);
          const v = Math.max(0, 1 - Math.abs(dist - r) / 0.9) * Math.max(0, 1 - age / 2);
          if (v > best) { best = v; h = p.hue + dist * 30; }
        }
        return best > 0 ? scale(s.colorful ? hsv(h, 1, 1) : base, best) : null;
      }
      case 10: {
        const n = this.snake.length, i = this.snake.indexOf(k), head = (T * 9) % n, d = (head - i + n) % n;
        return d < 10 ? scale(s.colorful ? hsv(i * 9, 1, 1) : base, 1 - d / 10) : null;
      }
      case 11: return hsv(T * 50, 1, 1);
      case 13: return scale(pick(hueX - T * 60), (Math.sin(k.cx * 0.7 - T * 4) + 1) / 2);
      case 15: return hsv((Math.atan2(k.cy - 3.1, k.cx - 8) * 180) / Math.PI + T * 120, 1, 1);
      case 16: return hsv(k.cy * 55 - T * 140, 1, 1);
      case 17: return hsv(Math.hypot(k.cx - 8, (k.cy - 3.1) * 1.4) * 45 - T * 140, 1, 1);
      case CUSTOM_EFFECT: { const c = s.colors ? keyColors.get(s.colors, k.i) : [0, 0, 0]; return c.every((v) => !v) ? null : c; }
      default: return null;
    }
  }

  draw(ts) {
    const s = this.state, ctx = this.ctx;
    if (!this.canvas.isConnected) return;
    if (this.canvas.width < 2) this.resize();
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!s.visible || !s.effect) return;
    const now = ts / 1000;
    const speedF = [0.35, 0.6, 1, 1.5, 2.2][s.speed ?? 2];
    const T = now * speedF;
    // Kullanıcı basmıyorsa örnek basışlar ve damlalar
    if (now > this.nextSim) {
      if ([4, 7, 12].includes(s.effect) && now - this.lastReal > 2.5) {
        const k = this.keys[Math.floor(Math.random() * this.keys.length)];
        this.presses.push({ k, t0: now, hue: Math.random() * 360 });
        if (this.presses.length > 40) this.presses.shift();
      }
      if (s.effect === 5 || s.effect === 8) {
        const k = this.keys[Math.floor(Math.random() * this.keys.length)];
        this.drops.push({ k, t0: now, hue: Math.random() * 360 });
        if (this.drops.length > 30) this.drops.shift();
      }
      this.nextSim = now + (s.effect === 7 ? 1.4 : s.effect === 5 ? 0.12 : s.effect === 8 ? 0.2 : 0.6) / speedF;
    }
    this.presses = this.presses.filter((p) => now - p.t0 < 2.2);
    this.drops = this.drops.filter((d) => now - d.t0 < 1.3);
    const bright = Math.max(0.12, (s.brightness ?? 9) / 9);
    const ux = W / F75_W, uy = H / F75_H, pad = 0.14;
    for (const k of this.keys) {
      const c = this.color(k, T, now);
      if (!c) continue;
      // Karanlık değerler siyaha değil şeffaflığa dönüşür: sönük tuşun arkasında plaka görünür
      const m = Math.max(c[0], c[1], c[2]);
      if (m < 4) continue;
      const f = 255 / m, a = (m / 255) * bright;
      ctx.fillStyle = `rgba(${(c[0] * f) | 0},${(c[1] * f) | 0},${(c[2] * f) | 0},${a.toFixed(3)})`;
      ctx.fillRect((k.x - pad) * ux, (k.y - pad) * uy, (k.w + pad * 2) * ux, (k.h + pad * 2) * uy);
    }
  }
}
