// Arayüz. i18n.js, layout.js, model.js, protocol.js, firmware.js ve effects.js bu dosyadan önce yüklenir.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const toHex = (u) => [...u].map((v) => v.toString(16).padStart(2, '0')).join('');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const S = {
  t: null, config: null, keymaps: [null, null, null, null], colors: null, palette: null,
  page: 'pLight', layer: 0, selKey: null, mods: 0, paint: '#7c82d6', painting: false,
  isp: null, ispPending: false, fw: null, knob: loadKnob(), knobSel: null, busy: false, lastStatus: null,
};
const PAGES = { pLight: 'light', pKeys: 'keys', pKnob: 'knob', pSettings: 'settings', pBackup: 'backup', pFirmware: 'firmware' };
const led = new LedPreview($('#board'));
const bat = new BatteryMonitor(() => renderBattery());

// ---------- pil ----------
async function setupBattery() {
  if (!S.t) { bat.detach(); return renderBattery(); }
  if (S.t.kind === 'wireless') {
    const tr = S.t;
    await bat.attach(tr.device, (cmd) => tr.q.run(() => dongleQuery(tr.device, cmd))).catch(() => {});
  } else {
    // Kablolu bağlıyken alıcıya da izin varsa onu dinle (klavye 2.4G modunda kabloyla şarj oluyorsa yüzde oradan gelir)
    const devs = 'hid' in navigator ? await navigator.hid.getDevices() : [];
    const rx = devs.find((d) => d.vendorId === IDS.wireless.vendorId && d.collections.some((c) => (c.outputReports || []).some((r) => r.reportId === 0x13)));
    if (rx) await bat.attach(rx, (cmd) => dongleQuery(rx, cmd)).catch(() => {});
    else bat.detach();
  }
  renderBattery();
}
function batteryText() {
  const s = bat.state;
  const pct = (v) => (LANG === 'tr' ? '%' + v : v + '%');
  if (!S.t) return null;
  if (bat.live && s) {
    const st = s.charging ? (s.level >= 100 ? t('bat.full') : t('bat.charging')) : t('bat.onBattery');
    return { level: s.level, charging: s.charging, text: pct(s.level) + ' · ' + st };
  }
  if (S.t.kind === 'wired') {
    const last = s ? ' · ' + t('bat.last', pct(s.level)) : '';
    return { level: s ? s.level : null, charging: true, text: t('bat.wired') + last };
  }
  return { level: s ? s.level : null, charging: false, text: t('bat.reading') };
}
function renderBattery() {
  const b = batteryText();
  const el = $('#battery');
  el.hidden = !b;
  if (!b) return;
  el.innerHTML = batteryIcon(b.level, b.charging) + '<span></span>';
  el.querySelector('span').textContent = b.text;
  el.title = t('bat.help');
  if ($('#infoBat')) $('#infoBat').textContent = b.text;
}

// ---------- durum ----------
function setStatus(key, kind = '', ...args) {
  S.lastStatus = { key, kind, args };
  $('#status').textContent = key ? t(key, ...args) : '';
  $('#status').className = 'status ' + kind;
}
async function task(key, fn) {
  S.lastStatus = { key, kind: 'busy', args: [] };
  $('#status').textContent = t(key) + '…';
  $('#status').className = 'status busy';
  try {
    const r = await fn();
    if (key === 'conn.reading') setStatus('conn.connected', 'ok');
    else {
      setStatus('conn.saved', 'ok');
      later('saved', () => { if (S.lastStatus && S.lastStatus.key === 'conn.saved' && S.config) setStatus('conn.connected', 'ok'); }, 2000);
    }
    return r;
  } catch (e) {
    console.error(e);
    setStatus('err', 'err', e.message);
    throw e;
  }
}
const run = (key, fn) => task(key, fn).catch(() => {});
const timers = {};
function later(name, fn, ms = 250) { clearTimeout(timers[name]); timers[name] = setTimeout(fn, ms); }
function loadKnob() { try { return JSON.parse(localStorage.getItem('aulaKnob')) || null; } catch { return null; } }
function saveKnob(k) { S.knob = k; try { localStorage.setItem('aulaKnob', JSON.stringify(k)); } catch { /* yok */ } }

// ---------- dil ve tema ----------
function setTheme(th) {
  document.documentElement.dataset.theme = th;
  try { localStorage.setItem('aulaTheme', th); } catch { /* yok */ }
  $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === th));
}
function bindPrefs() {
  $$('#langSeg button').forEach((b) => (b.onclick = () => { setLang(b.dataset.v); refreshLang(); }));
  $$('#themeSeg button').forEach((b) => (b.onclick = () => setTheme(b.dataset.v)));
  setTheme(document.documentElement.dataset.theme || 'light');
}
function refreshLang() {
  $$('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === LANG));
  document.title = 'AULA F75';
  if (S.lastStatus && S.lastStatus.key) setStatus(S.lastStatus.key, S.lastStatus.kind, ...S.lastStatus.args);
  go(S.page);
}

// ---------- bağlantı ----------
async function connect(device) {
  const tr = pickTransport(device);
  if (!tr) return false;
  if (S.t) await S.t.close().catch(() => {});
  S.t = tr;
  S.config = null;
  await tr.open();
  await run('conn.reading', async () => {
    const info = await tr.info();
    if (tr.kind === 'wireless' && !info.online) throw new Error(t('err.asleep'));
    const c = await tr.readConfig();
    if (!cfg.valid(c)) throw new Error(t('err.cfg'));
    for (let l = 0; l < 4; l++) S.keymaps[l] = await tr.readKeymap(l);
    S.colors = await tr.readColors();
    S.palette = await tr.readPalette();
    S.config = c;
  });
  document.body.classList.toggle('connected', !!S.config);
  setupBattery().catch(() => {});
  render();
  return !!S.config;
}
const wiredFirst = (a, b) => (b.vendorId === 0x258a) - (a.vendorId === 0x258a);
async function requestDevice() {
  if (!('hid' in navigator)) return setStatus('conn.noHid', 'err');
  const devs = await navigator.hid.requestDevice({ filters: hidFilters() });
  for (const d of devs.sort(wiredFirst)) if (await connect(d)) return;
}
async function autoConnect() {
  if (!('hid' in navigator) || S.isp || S.ispPending) return;
  const devs = await navigator.hid.getDevices();
  for (const d of devs.sort(wiredFirst)) if (await connect(d)) return;
}

// ---------- sayfalar ----------
function go(page) {
  S.page = page;
  $$('nav button').forEach((b) => b.classList.toggle('on', b.dataset.p === page));
  $$('section.page').forEach((p) => (p.hidden = p.id !== page));
  $('#title').textContent = t('nav.' + PAGES[page]);
  $('#subtitle').textContent = t('sub.' + PAGES[page]);
  render();
}

// ---------- klavye çizimi ----------
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function capLegend(k) { return LANG === 'en' ? [k.le, k.te] : [k.l, k.t]; }
function renderBoard() {
  const el = $('#board');
  const show = !!S.config && ['pLight', 'pKeys', 'pKnob'].includes(S.page);
  $('#stage').hidden = !show;
  if (!show) { led.set({ ...led.state, visible: false }); return; }
  const mode = S.page === 'pKeys' ? 'keys' : S.page === 'pKnob' ? 'knob' : 'light';
  const eff = cfg.effect(S.config);
  const custom = eff === CUSTOM_EFFECT && S.colors;
  el.innerHTML = '<span class="led"></span>';
  const defMap = fromHex(DEFAULT_KEYMAPS[S.layer]);
  for (const k of F75) {
    const [main, top] = capLegend(k);
    const d = document.createElement('div');
    d.className = 'cap c-' + k.c + (k.w >= 1.5 ? ' wide' : '') + ((main || '').length >= 2 ? ' small' : '') + (k.knob ? ' knob' : '');
    d.dataset.n = k.n;
    d.style.left = (k.x / F75_W) * 100 + '%';
    d.style.top = (k.y / F75_H) * 100 + '%';
    d.style.width = (k.w / F75_W) * 100 + '%';
    d.style.height = (k.h / F75_H) * 100 + '%';
    d.innerHTML = '<div class="k"></div><div class="f"><span class="t"></span><span class="m"></span><span class="a"></span></div>';
    d.querySelector('.t').textContent = top;
    d.querySelector('.m').textContent = main;
    d.title = k.knob ? t('nav.knob') : main || k.n;
    if (mode === 'light' && custom && !k.knob) {
      // Tuş kendi renginde kalır; ışık rengi alttaki parıltı ve tuş üstündeki noktayla gösterilir
      const paint = (c) => {
        const on = !c.every((v) => v === 0);
        d.classList.add('paint');
        d.classList.toggle('lit', on);
        d.style.setProperty('--ledc', rgb2hex(c));
        d.title = (main || k.n) + ' · ' + (on ? rgb2hex(c).toUpperCase() : t('light.off'));
      };
      paint(keyColors.get(S.colors, k.i));
      const apply = () => { const c = hex2rgb(S.paint); keyColors.set(S.colors, k.i, c); paint(c); led.kick(); };
      d.onpointerdown = (e) => { e.preventDefault(); S.painting = true; apply(); };
      d.onpointerenter = () => S.painting && apply();
    } else if (mode === 'keys' && S.keymaps[S.layer]) {
      const b = S.keymaps[S.layer].subarray(k.i * 4, k.i * 4 + 4);
      const changed = !sameCode(b, defMap.subarray(k.i * 4, k.i * 4 + 4));
      d.classList.toggle('chg', changed && !k.knob);
      d.classList.toggle('sel', S.selKey === k);
      if (changed && !k.knob) d.querySelector('.a').textContent = label(b) || t('keys.off');
      d.title = (k.knob ? t('keys.knobPress') : main || k.n) + ' → ' + (label(b) || t('keys.empty'));
      d.onclick = () => { S.selKey = k; S.mods = 0; $('#aSearch').value = ''; renderKeys(); };
    } else if (k.knob) {
      d.classList.toggle('sel', mode === 'knob');
      d.onclick = () => go('pKnob');
    }
    el.append(d);
  }
  led.attach();
  syncLed();
  const hint = mode === 'light' ? (custom ? t('light.paintHint') : t('light.previewHint'))
    : mode === 'keys' ? (S.layer === 0 ? t('keys.hintKnob') : t('keys.hintLayer', ['', 'Fn', 'Fn2', 'Tap'][S.layer]))
      : t('knob.hint');
  $('#stageHint').textContent = hint;
}
function syncLed() {
  const eff = cfg.effect(S.config);
  led.set({
    visible: !$('#stage').hidden && S.page === 'pLight', effect: eff, brightness: eff ? cfg.brightness(S.config, eff) : 0, speed: eff ? cfg.speed(S.config, eff) : 2,
    colorful: eff ? cfg.colorful(S.config, eff) : false, color: palette.get(S.palette || fromHex(DEFAULT_PALETTE), eff), colors: S.colors,
  });
}
// Bu sayfadayken basılan gerçek tuşlar ekranda da yanar
document.addEventListener('keydown', (e) => {
  if (!S.config || S.page !== 'pLight' || e.repeat) return;
  const n = keyFromEvent(e);
  if (!n) return;
  led.press(n);
  const cap = $(`#board .cap[data-n="${CSS.escape(n)}"]`);
  if (cap) { cap.classList.add('down'); setTimeout(() => cap.classList.remove('down'), 120); }
});
window.addEventListener('resize', () => later('resize', () => { led.resize(); led.kick(); }, 150));

// ---------- ışık ----------
const SWATCHES = ['#ff0000', '#ff7a00', '#ffd400', '#00d26a', '#00c8ff', '#2f5bff', '#9b4dff', '#ff3fa4', '#ffffff', '#000000'];
function renderSwatches() {
  const box = $('#swatches');
  if (!box.children.length) {
    for (const c of SWATCHES) {
      const b = document.createElement('button');
      b.className = 'swatch' + (c === '#000000' ? ' off' : '');
      b.style.setProperty('--sw', c);
      b.dataset.c = c;
      b.onclick = () => { S.paint = c; if (c !== '#000000') $('#paintColor').value = c; renderSwatches(); };
      box.append(b);
    }
  }
  [...box.children].forEach((b) => {
    b.classList.toggle('on', b.dataset.c === S.paint.toLowerCase());
    b.title = b.dataset.c === '#000000' ? t('light.off') : b.dataset.c.toUpperCase();
  });
  $('#paintColor').parentElement.classList.toggle('on', !SWATCHES.includes(S.paint.toLowerCase()));
}
function renderLight() {
  const c = S.config;
  const eff = cfg.effect(c);
  $('#effects').innerHTML = '';
  for (const e of EFFECTS) {
    const b = document.createElement('button');
    b.textContent = e.name;
    b.title = e.desc;
    b.className = e.id === eff ? 'on' : '';
    b.onclick = () => {
      if (e.id === CUSTOM_EFFECT && !S.colors) return setStatus('task.customWired', 'err');
      cfg.setEffect(S.config, e.id);
      render();
      run('task.effect', () => S.t.writeConfig(S.config));
    };
    $('#effects').append(b);
  }
  $('#effDesc').textContent = t('effd.' + eff);
  const on = eff !== 0;
  const custom = eff === CUSTOM_EFFECT;
  $('#lightControls').hidden = !on;
  $('#customPanel').hidden = !custom || S.page !== 'pLight';
  renderSwatches();
  if (!on) return;
  $('#bright').value = cfg.brightness(c, eff);
  $('#brightVal').textContent = cfg.brightness(c, eff);
  $('#speed').value = cfg.speed(c, eff);
  $('#speedVal').textContent = cfg.speed(c, eff);
  $('#speedRow').hidden = custom || eff === 1;
  $('#colorRow').hidden = custom;
  $('#colorful').checked = cfg.colorful(c, eff);
  $('#effColor').disabled = cfg.colorful(c, eff);
  $('#effColor').value = rgb2hex(palette.get(S.palette || fromHex(DEFAULT_PALETTE), eff));
}
function bindLight() {
  const cur = () => cfg.effect(S.config);
  $('#bright').oninput = (e) => {
    cfg.setBrightness(S.config, cur(), +e.target.value);
    $('#brightVal').textContent = e.target.value;
    syncLed();
    later('cfg', () => run('task.bright', () => S.t.writeConfig(S.config)));
  };
  $('#speed').oninput = (e) => {
    cfg.setSpeed(S.config, cur(), +e.target.value);
    $('#speedVal').textContent = e.target.value;
    syncLed();
    later('cfg', () => run('task.speed', () => S.t.writeConfig(S.config)));
  };
  $('#colorful').onchange = (e) => {
    cfg.setColorful(S.config, cur(), e.target.checked);
    $('#effColor').disabled = e.target.checked;
    syncLed();
    run('task.colorMode', () => S.t.writeConfig(S.config));
  };
  $('#effColor').oninput = (e) => {
    if (!S.palette) S.palette = fromHex(DEFAULT_PALETTE);
    palette.set(S.palette, cur(), hex2rgb(e.target.value));
    cfg.setColorful(S.config, cur(), false);
    $('#colorful').checked = false;
    syncLed();
    later('pal', () => run('task.color', async () => { await S.t.writePalette(S.palette); await S.t.writeConfig(S.config); }), 300);
  };
  $('#paintColor').oninput = (e) => { S.paint = e.target.value; renderSwatches(); };
  $('#fillAll').onclick = () => {
    for (const k of F75) if (!k.knob) keyColors.set(S.colors, k.i, hex2rgb(S.paint));
    render();
    run('task.colors', () => S.t.writeColors(S.colors));
  };
  $('#clearAll').onclick = () => { S.colors.fill(0); render(); run('task.colors', () => S.t.writeColors(S.colors)); };
  window.addEventListener('pointerup', () => {
    if (!S.painting) return;
    S.painting = false;
    run('task.colors', () => S.t.writeColors(S.colors));
  });
}

// ---------- tuş atama ----------
function catalog() {
  const groups = [
    ['grp.keys', HID_CODES.map((c) => [hidName(c), () => (S.mods ? code.combo(S.mods, c) : code.key(c))])],
    ['grp.media', MEDIA.map((u) => [t('media.' + u), () => code.media(u)])],
    ['grp.mouse', MOUSE.map((b) => [t('mouse.' + b), () => code.mouse(b)])],
    ['grp.light', LIGHTFN.map((h) => [t('lfn.' + h), () => code.raw(h)])],
    ['grp.special', SPECIAL.map((h) => [t('sp.' + h), () => code.raw(h)])],
  ];
  if (S.selKey && S.selKey.knob && S.layer === 0) groups.unshift(['grp.knob', [[t('sp.0700001d'), () => code.raw(KNOB_VOLUME)]]]);
  return groups;
}
function renderKeys() {
  const ok = S.keymaps.every(Boolean);
  $('#keysOff').hidden = ok;
  $('#keysOn').hidden = !ok;
  if (!ok) return;
  $$('#layers button').forEach((b) => b.classList.toggle('on', +b.dataset.l === S.layer));
  renderBoard();
  const k = S.selKey;
  $('#assign').hidden = !k;
  $('#keysHint').hidden = !!k;
  if (!k) return;
  const cur = S.keymaps[S.layer].subarray(k.i * 4, k.i * 4 + 4);
  const layerName = [t('keys.normal'), 'Fn', 'Fn2', 'Tap'][S.layer];
  $('#assignTitle').textContent = (k.knob ? t('keys.knobPress') : t('keys.title', capLegend(k)[0] || k.n)) + ' · ' + layerName;
  $('#assignCur').textContent = t('keys.now', label(cur) || t('keys.empty')) + (k.knob && S.layer === 0 ? t('keys.knobWarn') : '');
  $('#aMods').innerHTML = '';
  for (const m of MODS.slice(0, 4)) {
    const b = document.createElement('button');
    b.textContent = modName(m);
    b.className = S.mods & m ? 'on' : '';
    b.onclick = () => { S.mods ^= m; renderKeys(); };
    $('#aMods').append(b);
  }
  const loc = LANG === 'tr' ? 'tr' : 'en';
  const q = $('#aSearch').value.trim().toLocaleLowerCase(loc);
  const curLabel = label(cur);
  $('#aList').innerHTML = '';
  for (const [g, items] of catalog()) {
    const list = items.filter(([n]) => !q || n.toLocaleLowerCase(loc).includes(q));
    if (!list.length) continue;
    const h = document.createElement('div');
    h.className = 'fn-group';
    h.textContent = t(g);
    const box = document.createElement('div');
    box.className = 'fn-items';
    for (const [n, make] of list) {
      const b = document.createElement('button');
      b.textContent = n;
      b.title = n;
      if (n === curLabel) b.className = 'cur';
      b.onclick = () => setKey(make());
      box.append(b);
    }
    $('#aList').append(h, box);
  }
}
function setKey(bytes) {
  const k = S.selKey;
  if (!k) return;
  const l = S.layer;
  S.keymaps[l].set(bytes, k.i * 4);
  renderKeys();
  run('task.key', () => S.t.writeKeymap(l, S.keymaps[l]));
}
function bindKeys() {
  $$('#layers button').forEach((b) => (b.onclick = () => { S.layer = +b.dataset.l; renderKeys(); }));
  $('#aSearch').oninput = () => renderKeys();
  $('#aReset').onclick = () => { const k = S.selKey; if (k) setKey(fromHex(DEFAULT_KEYMAPS[S.layer]).subarray(k.i * 4, k.i * 4 + 4)); };
  $('#aResetLayer').onclick = () => {
    if (!confirm(t('keys.confirmLayer'))) return;
    const l = S.layer;
    S.keymaps[l] = fromHex(DEFAULT_KEYMAPS[l]);
    renderKeys();
    run('task.layer', () => S.t.writeKeymap(l, S.keymaps[l]));
  };
}

// ---------- tekerlek ----------
const knobName = (v) => t('knob.' + v);
const KNOB_STEPS = ['enter', 'read', 'write', 'boot'];
function renderKnob() {
  if (!S.knobSel) S.knobSel = { ...(S.knob || { rotate: 'volume', press: 'mute' }) };
  $$('#knobRotate button').forEach((b) => { b.classList.toggle('on', b.dataset.v === S.knobSel.rotate); b.disabled = !!S.knobRun; });
  $$('#knobPress button').forEach((b) => { b.classList.toggle('on', b.dataset.v === S.knobSel.press); b.disabled = !!S.knobRun; });
  $('#knobNow').textContent = S.knob ? t('knob.on', knobName(S.knob.rotate), knobName(S.knob.press)) : t('knob.unknown');
  const same = S.knob && S.knob.rotate === S.knobSel.rotate && S.knob.press === S.knobSel.press;
  const wired = S.t && S.t.kind === 'wired';
  $('#knobApply').disabled = S.busy || !!S.knobRun || same || !wired;
  $('#knobNote').textContent = S.knobRun ? t('knob.busy') : !wired ? t('knob.needCable') : same ? t('knob.same') : t('knob.ready');
  const fn = S.keymaps[1] && S.keymaps[1].subarray(84 * 4, 84 * 4 + 4);
  $('#knobFn').textContent = fn ? (label(fn) || t('knob.fnUnset')) : t('knob.fnWired');
}
// Adım listesi: her adım bekliyor, sürüyor (run), bitti (done) ya da hata (err)
function knobStep(step, state, done, total) {
  $('#knobSteps').hidden = false;
  const idx = KNOB_STEPS.indexOf(step);
  $$('#knobSteps li').forEach((li, i) => {
    li.className = i < idx ? 'done' : i === idx ? state : '';
    li.querySelector('em').textContent = i === idx && state === 'run' && total ? Math.round((done / total) * 100) + '%' : '';
  });
}
function knobResult(text, kind, opts = {}) {
  $('#knobResult').hidden = !text;
  $('#knobResult').className = 'result ' + (kind || '');
  $('#knobMsg').textContent = text || '';
  $('#knobPick').hidden = !opts.pick;
  $('#knobDl').hidden = !S.knobBackup || !opts.dl;
}
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
async function ispSession(d) {
  S.isp = new IspDevice(d);
  await S.isp.open();
  document.body.classList.add('isp');
  S.ispPending = false;
  render();
}
async function ispFinish() {
  await S.isp.reboot();
  await S.isp.close();
  S.isp = null;
  document.body.classList.remove('isp');
  await wait(3000);
  await autoConnect();
}
async function enterIspFromKeyboard() {
  if (!S.t || S.t.kind !== 'wired') throw new Error(t('err.wired'));
  S.ispPending = true;
  await enterIsp(S.t.device);
  S.t = null;
  S.config = null;
  document.body.classList.remove('connected');
  render();
  return waitIsp(8000);
}
async function waitIsp(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = await findIsp();
    if (d) return d;
    await wait(500);
  }
  return null;
}
async function waitKeyboard(ms) {
  const t0 = Date.now();
  while (!S.config && Date.now() - t0 < ms) { await autoConnect().catch(() => {}); if (!S.config) await wait(1000); }
  return !!S.config;
}
function knobEnd() {
  S.knobRun = null;
  S.busy = false;
  document.body.classList.remove('knob-run');
  render();
}
// Yükleyiciye bağlandıktan sonrası tek akış: oku, yedekle, yaz, doğrula, yeniden başlat
async function knobWrite(d) {
  const sel = S.knobRun;
  let fw = null;
  let step = 'read';
  try {
    await ispSession(d);
    knobResult('');
    knobStep('read', 'run');
    fw = await S.isp.readFirmware((i, n) => knobStep('read', 'run', i, n));
    if (!knobPatchable(fw)) throw new Error(t('knob.unknownFw'));
    S.knobBackup = fw;
    try { if (!localStorage.getItem('aulaFwOrig')) localStorage.setItem('aulaFwOrig', b64(fw)); } catch { /* yer yok */ }
    step = 'write';
    knobStep('write', 'run');
    const img = applyKnob(fw, sel.rotate, sel.press);
    if (!img.every((v, i) => v === fw[i])) await S.isp.writeFirmware(img, (i, n) => knobStep('write', 'run', i, n));
    saveKnob({ rotate: sel.rotate, press: sel.press });
    step = 'boot';
    knobStep('boot', 'run');
    await ispFinish();
    const ok = await waitKeyboard(10000);
    $$('#knobSteps li').forEach((li) => { li.className = 'done'; li.querySelector('em').textContent = ''; });
    knobResult(t(ok ? 'knob.doneTry' : 'knob.doneLater', knobName(sel.rotate), knobName(sel.press)), 'ok', { dl: true });
  } catch (e) {
    console.error(e);
    knobStep(step, 'err');
    let msg = t('err', e.message);
    if (S.isp && step === 'write' && fw) {
      // Doğrulama tutmadı: okunan orijinali bir kez geri yaz
      try { await S.isp.writeFirmware(fw); msg = t('knob.rolledBack'); } catch (e2) { console.error(e2); knobResult(t('knob.stuck'), 'err', { dl: true }); knobEnd(); return; }
    }
    if (S.isp) { await ispFinish().catch(() => {}); await waitKeyboard(10000); }
    knobResult(msg, 'err', { dl: step !== 'read' });
  } finally {
    if (S.knobRun) knobEnd();
  }
}
function bindKnob() {
  $$('#knobRotate button').forEach((b) => (b.onclick = () => { S.knobSel.rotate = b.dataset.v; knobResult(''); renderKnob(); }));
  $$('#knobPress button').forEach((b) => (b.onclick = () => { S.knobSel.press = b.dataset.v; knobResult(''); renderKnob(); }));
  $('#knobApply').onclick = async () => {
    if (S.busy || S.knobRun) return;
    S.busy = true;
    S.knobRun = { ...S.knobSel };
    S.knobBackup = null;
    document.body.classList.add('knob-run');
    knobResult('');
    knobStep('enter', 'run');
    renderKnob();
    try {
      const d = await enterIspFromKeyboard();
      if (d) return knobWrite(d);
      // Tarayıcıda yükleyici bir kez listeden seçilir (masaüstü uygulamasında gerekmez)
      knobResult(t('knob.pickHelp'), '', { pick: true });
    } catch (e) {
      knobStep('enter', 'err');
      knobResult(t('err', e.message), 'err');
      knobEnd();
    }
  };
  $('#knobPick').onclick = () => {
    requestIsp().then((d) => (d ? knobWrite(d) : null)).catch((e) => knobResult(t('err', e.message), 'err', { pick: true }));
  };
  $('#knobDl').onclick = () => S.knobBackup && download(S.knobBackup, 'BEFORE-' + fwName());
  window.addEventListener('beforeunload', (e) => { if (S.knobRun && S.isp) { e.preventDefault(); e.returnValue = ''; } });
  $('#knobFnEdit').onclick = () => { S.layer = 1; S.selKey = F75.find((k) => k.knob); S.mods = 0; go('pKeys'); };
}

// ---------- ayarlar ----------
function renderSettings() {
  $('#sleep').innerHTML = SLEEP_OPTIONS.map((v) => `<option value="${v}">${sleepLabel(v)}</option>`).join('');
  const s = cfg.sleep(S.config);
  if (!SLEEP_OPTIONS.includes(s)) $('#sleep').insertAdjacentHTML('beforeend', `<option value="${s}">${sleepLabel(s)}</option>`);
  $('#sleep').value = s;
  $('#debounce').value = cfg.debounce(S.config);
  $('#debounceVal').textContent = cfg.debounce(S.config) + 1;
  const tap = cfg.tap(S.config);
  $('#tapOn').checked = tap > 0;
  $('#tapRow').hidden = tap === 0;
  if (tap) { $('#tapSens').value = tap; $('#tapVal').textContent = tap; }
  const d = S.t.device;
  $('#infoLink').textContent = S.t.kind === 'wired' ? t('conn.usb') : t('conn.rf');
  $('#infoId').textContent = [d.vendorId, d.productId].map((v) => v.toString(16).toUpperCase().padStart(4, '0')).join(':');
}
function bindSettings() {
  $('#tapOn').onchange = (e) => { cfg.setTap(S.config, e.target.checked ? 127 : 0); renderSettings(); run('task.tap', () => S.t.writeConfig(S.config)); };
  $('#tapSens').oninput = (e) => {
    cfg.setTap(S.config, +e.target.value);
    $('#tapVal').textContent = e.target.value;
    later('cfg', () => run('task.tap', () => S.t.writeConfig(S.config)));
  };
  $('#sleep').onchange = (e) => { cfg.setSleep(S.config, +e.target.value); run('task.sleep', () => S.t.writeConfig(S.config)); };
  $('#debounce').oninput = (e) => {
    cfg.setDebounce(S.config, +e.target.value);
    $('#debounceVal').textContent = +e.target.value + 1;
    later('cfg', () => run('task.debounce', () => S.t.writeConfig(S.config)));
  };
  $('#defaults').onclick = async () => {
    if (!confirm(t('set.confirmReset'))) return;
    await run('task.factory', async () => {
      for (let l = 0; l < 4; l++) if (S.keymaps[l]) await S.t.writeKeymap(l, (S.keymaps[l] = fromHex(DEFAULT_KEYMAPS[l])));
      await S.t.writeConfig((S.config = fromHex(FACTORY_CONFIG)));
      await S.t.writePalette((S.palette = fromHex(DEFAULT_PALETTE)));
    });
    render();
  };
}

// ---------- yedek ----------
function download(bytes, name, type = 'application/octet-stream') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function backupData() {
  return {
    app: 'aula-f75-web', version: 1, date: new Date().toISOString(),
    config: toHex(S.config), keymaps: S.keymaps.map((k) => (k ? toHex(k) : null)),
    colors: S.colors ? toHex(S.colors) : null, palette: S.palette ? toHex(S.palette) : null,
  };
}
async function restoreData(d) {
  if (d.app !== 'aula-f75-web') throw new Error(t('bk.notAula'));
  const c = fromHex(d.config);
  if (!cfg.valid(c)) throw new Error(t('bk.badCfg'));
  if (d.palette) await S.t.writePalette((S.palette = fromHex(d.palette)));
  if (d.colors && S.colors) await S.t.writeColors((S.colors = fromHex(d.colors)));
  for (let l = 0; l < 4; l++) if (d.keymaps[l] && S.keymaps[l]) await S.t.writeKeymap(l, (S.keymaps[l] = fromHex(d.keymaps[l])));
  await S.t.writeConfig((S.config = c));
}
function bindBackup() {
  $('#export').onclick = () => download(JSON.stringify(backupData(), null, 1), 'aula-f75-settings.json', 'application/json');
  $('#importFile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let d;
    try { d = JSON.parse(await f.text()); } catch { return setStatus('bk.bad', 'err'); }
    await run('task.restore', () => restoreData(d));
    render();
  };
}

// ---------- firmware sekmesi ----------
function fwMsg(text, kind = '') { $('#fwMsg').textContent = text; $('#fwMsg').className = kind === 'err' ? 'status err' : kind === 'ok' ? 'status ok' : 'muted'; }
function fwProgress(done, total) { const p = $('#fwProg'); p.hidden = !total; if (total) { p.max = total; p.value = done; } }
const fwName = () => 'aula-f75-firmware-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.bin';
async function fwTask(text, fn) {
  if (S.busy) return;
  S.busy = true;
  fwMsg(text + '…');
  try { await fn(); } catch (e) { console.error(e); fwMsg(t('err', e.message), 'err'); } finally { S.busy = false; fwProgress(0, 0); }
}
async function fwOpen(d) {
  await ispSession(d);
  $('#fwStep1').hidden = true;
  $('#fwStep2').hidden = false;
  go('pFirmware');
  fwMsg(t('knob.reading') + '…');
  S.fw = await S.isp.readFirmware(fwProgress);
  S.fwSaved = false;
  const st = knobState(S.fw);
  const known = knobPatchable(S.fw);
  $('#fwInfo').textContent = known ? t('fw.known', knobName(st.rotate), knobName(st.press)) : t('fw.unknown');
  if (known) saveKnob(st);
  fwMsg(t('fw.read'), 'ok');
}
function bindFirmware() {
  $('#fwEnter').onclick = () => fwTask(t('knob.entering'), async () => {
    const d = await enterIspFromKeyboard();
    if (d) return fwOpen(d);
    fwMsg(t('fw.waitPick'));
  });
  $('#fwConnect').onclick = () => {
    const req = requestIsp();
    fwTask(t('fw.connect'), async () => { const d = (await findIsp()) || (await req); if (d) await fwOpen(d); });
  };
  $('#fwBackup').onclick = () => fwTask(t('knob.reading'), async () => {
    S.fw = await S.isp.readFirmware(fwProgress);
    download(S.fw, fwName());
    S.fwSaved = true;
    fwMsg(t('fw.saved'), 'ok');
  });
  $('#fwFile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const img = new Uint8Array(await f.arrayBuffer());
    if (img.length !== ISP.FW_SIZE || img[0] !== 0x02) return fwMsg(t('fw.badFile'), 'err');
    if (!confirm(t('fw.confirmFile', f.name))) return;
    if (!S.fwSaved) { download(S.fw, 'BEFORE-' + fwName()); S.fwSaved = true; }
    fwTask(t('knob.writing'), async () => {
      await S.isp.writeFirmware(img, fwProgress);
      S.fw = new Uint8Array(img);
      fwMsg(t('fw.written'), 'ok');
    });
  };
  $('#fwReboot').onclick = () => fwTask(t('knob.rebooting'), async () => {
    $('#fwStep1').hidden = false;
    $('#fwStep2').hidden = true;
    await ispFinish();
    fwMsg(t('fw.normal'), 'ok');
  });
}

// ---------- genel ----------
function fillRange(r) { r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min)) * 100 + '%'); }
document.addEventListener('input', (e) => { if (e.target.type === 'range') fillRange(e.target); });
function render() {
  applyI18n();
  $('#device').textContent = S.isp ? t('conn.isp') : S.config ? (S.t.kind === 'wired' ? t('conn.usb') : t('conn.rf')) : S.ispPending ? t('conn.ispGoing') : t('conn.none');
  $('#connect').hidden = !!S.config || !!S.isp || S.ispPending;
  renderBattery();
  if (S.config) {
    renderLight();
    renderSettings();
    renderKnob();
    if (S.page === 'pKeys') renderKeys(); else renderBoard();
    $$('input[type=range]').forEach(fillRange);
  } else {
    $('#stage').hidden = true;
    led.set({ ...led.state, visible: false });
  }
}

$$('nav button').forEach((b) => (b.onclick = () => go(b.dataset.p)));
$('#connect').onclick = () => requestDevice().catch((e) => setStatus('err', 'err', e.message));
if ('hid' in navigator) {
  navigator.hid.addEventListener('disconnect', (e) => {
    if (S.t && e.device === S.t.device) {
      S.t = null;
      S.config = null;
      document.body.classList.remove('connected');
      setStatus('conn.unplugged');
      bat.detach();
      render();
      setTimeout(() => autoConnect().catch(() => {}), 1500);
    }
  });
  navigator.hid.addEventListener('connect', () => { if (!S.t && !S.isp && !S.ispPending && !S.knobRun) setTimeout(() => autoConnect().catch(() => {}), 800); });
}
bindPrefs();
bindLight();
bindKeys();
bindKnob();
bindSettings();
bindBackup();
bindFirmware();
document.documentElement.lang = LANG;
refreshLang();
autoConnect().catch(() => {});

window.__aula = { S, backupData, restoreData, render, go, led, bat };
