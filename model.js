// Ayar bloğu ve tuş kodlarının anlamı. Hepsi gerçek klavyeden ölçüldü.

const EFFECTS = [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 15, 16, 17, 0x15, 0].map((id) => ({ id, get name() { return t('eff.' + id); }, get desc() { return t('effd.' + id); } }));
const CUSTOM_EFFECT = 0x15;

// Ayar bloğu (128 bayt)
const OFF = { debounce: 3, customFlag: 9, effect: 10, tap: 22, sleep: 24, perEffect: 0x3a };
const SLEEP_OPTIONS = [0, 2, 3, 4, 6, 8, 10, 20, 30, 40];
function sleepLabel(v) {
  if (!v) return t('sleep.0');
  const s = v * 30;
  if (s % 60) return s >= 60 ? t('sleep.min', (s / 60).toLocaleString(LANG === 'tr' ? 'tr-TR' : 'en-US')) : t('sleep.sec', s);
  return t('sleep.min', s / 60);
}

const cfg = {
  effect: (c) => c[OFF.effect],
  setEffect(c, id) { c[OFF.effect] = id; c[OFF.customFlag] = id === CUSTOM_EFFECT ? 1 : 0; },
  slot: (id) => OFF.perEffect + 2 * (id - 1),
  brightness: (c, id) => c[cfg.slot(id)],
  setBrightness(c, id, v) { c[cfg.slot(id)] = Math.max(0, Math.min(9, v)); },
  speed: (c, id) => c[cfg.slot(id) + 1] >> 4,
  setSpeed(c, id, v) { const o = cfg.slot(id) + 1; c[o] = (Math.max(0, Math.min(4, v)) << 4) | (c[o] & 0x0f); },
  colorful: (c, id) => (c[cfg.slot(id) + 1] & 0x0f) === 7,
  setColorful(c, id, on) { const o = cfg.slot(id) + 1; c[o] = (c[o] & 0xf0) | (on ? 7 : 0); },
  sleep: (c) => c[OFF.sleep],
  setSleep(c, v) { c[OFF.sleep] = v; },
  debounce: (c) => c[OFF.debounce],
  setDebounce(c, v) { c[OFF.debounce] = Math.max(0, Math.min(4, v)); },
  // Tap: 0 = kapalı, açıkken değer hassasiyettir (10–127).
  tap: (c) => c[OFF.tap],
  setTap(c, v) { c[OFF.tap] = v === 0 ? 0 : Math.max(10, Math.min(127, v)); },
  valid: (c) => c.length === 128 && c[126] === 0x5a && c[127] === 0xa5,
};

// Palet: her efekt için 7 renk x RGB = 21 bayt, efekt numarası x 21 adresinde.
const palette = {
  get(p, id) { const o = id * 21; return [p[o], p[o + 1], p[o + 2]]; },
  set(p, id, rgb) { p.set(rgb, id * 21); },
};

// Tuş başına renk: R, G, B düzlemleri, her biri 126 bayt.
const keyColors = {
  get: (k, i) => [k[i], k[126 + i], k[252 + i]],
  set(k, i, [r, g, b]) { k[i] = r; k[126 + i] = g; k[252 + i] = b; },
};

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// ---- Tuş kodları (her tuş 4 bayt) ----
const MODS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];
const modName = (m) => t('mod.' + m);

const HID = {};
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => (HID[0x04 + i] = c));
'1234567890'.split('').forEach((c, i) => (HID[0x1e + i] = c));
Object.assign(HID, {
  0x28: 'Enter', 0x29: 'Esc', 0x2a: 'Backspace', 0x2b: 'Tab', 0x39: 'Caps Lock', 0x46: 'Print Screen', 0x47: 'Scroll Lock', 0x48: 'Pause',
  0x49: 'Insert', 0x4a: 'Home', 0x4b: 'Page Up', 0x4c: 'Delete', 0x4d: 'End', 0x4e: 'Page Down', 0x53: 'Num Lock', 0x54: 'Num /',
  0x55: 'Num *', 0x56: 'Num -', 0x57: 'Num +', 0x58: 'Num Enter', 0x63: 'Num .', 0x64: '< > (ISO)',
});
for (let i = 0; i < 12; i++) HID[0x3a + i] = 'F' + (i + 1);
for (let i = 0; i < 9; i++) HID[0x59 + i] = 'Num ' + (i + 1);
HID[0x62] = 'Num 0';
for (let i = 0; i < 12; i++) HID[0x68 + i] = 'F' + (13 + i);
[0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x4f, 0x50, 0x51, 0x52, 0x65].forEach((c) => (HID[c] = null));
const hidName = (c) => (HID[c] === null ? t('hid.' + c) : HID[c]);
const HID_CODES = Object.keys(HID).map(Number).sort((a, b) => a - b);

const MEDIA = [0xcd, 0xb7, 0xb6, 0xb5, 0xe2, 0xe9, 0xea, 0x6f, 0x70, 0x223, 0x18a, 0x192, 0x194, 0x22a, 0x183];
const MOUSE = [1, 2, 3, 4, 5];
const LIGHTFN = ['08030100', '08030200', '08040100', '08040200'];
const SPECIAL = ['00000000', '07000001', '07000002'];

const code = {
  key: (hid) => [0, 0, 0, hid],
  combo: (mods, hid) => (hid ? [0, mods, hid, 0] : [0, mods, 0, 0]),
  media: (u) => [2, 0, u >> 8, u & 0xff],
  mouse: (b) => [1, b, 1, 0],
  raw: (hex) => hex.match(/../g).map((x) => parseInt(x, 16)),
};

function label(b) {
  const [ty, a, c, d] = b;
  const hex = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  if (hex === '0700001d' || SPECIAL.includes(hex)) return t('sp.' + hex);
  if (ty === 0) {
    const mods = MODS.filter((m) => a & m).map(modName);
    const keys = [c, d].filter(Boolean).map((k) => (k in HID ? hidName(k) : t('lbl.key', k.toString(16))));
    return [...mods, ...keys].join(' + ');
  }
  if (ty === 1) return MOUSE.includes(a) ? t('mouse.' + a) : t('lbl.mouse', a);
  if (ty === 2) { const u = (c << 8) | d; return MEDIA.includes(u) ? t('media.' + u) : t('lbl.media', u.toString(16)); }
  if (ty === 8) return LIGHTFN.includes(hex) ? t('lfn.' + hex) : t('lbl.light');
  return t('lbl.special', hex);
}

function sameCode(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }
