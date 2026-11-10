// AULA F75 WebHID protokolü.
// Kablolu (USB 258a:010c): 520 baytlık feature report 6.
//   Başlık: [işlem, tür, 0, sayfa sayısı, sayfa, uzunluk_lo, uzunluk_hi] + veri.
//   Yazma işlemleri: 03 tuş haritası (tür = katman), 04 ayar, 06 tuş renkleri, 0a renk paleti.
//   Okuma = yazma | 0x80.
//   0x08 / 0x88 klavyenin firmware belleğine dokunuyor. BU KODDA ASLA KULLANILMAZ.
// Kablosuz (2.4G alıcı 3554:fa09): 20 baytlık rapor 0x13.
//   [komut, toplam paket, sıra, (katman<<4)|uzunluk, 14 bayt veri, sağlama toplamı].
//   Komutlar: 01 tuş haritası, 02 tuş renkleri, 04 ayar, 09 palet, 44 ayarı oku,
//   05 sürüm, 07 bağlantı durumu. Klavye her paketi aynen geri göndererek onaylıyor.

const IDS = {
  wired: { vendorId: 0x258a, productId: 0x010c },
  wireless: { vendorId: 0x3554, productId: 0xfa09 },
};

const SIZES = { config: 0x80, keymap: 0x200, colors: 0x180, palette: 0x200 };
const FORBIDDEN_OPS = new Set([0x08, 0x88]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hidFilters() {
  return [
    { ...IDS.wired, usagePage: 0xff00 },
    { ...IDS.wireless, usagePage: 0xff02 },
  ];
}

function hasFeature(device, id) {
  return device.collections.some((c) => (c.featureReports || []).some((r) => r.reportId === id));
}
function hasOutput(device, id) {
  return device.collections.some((c) => (c.outputReports || []).some((r) => r.reportId === id));
}

function pickTransport(device) {
  if (device.vendorId === IDS.wired.vendorId && hasFeature(device, 6)) return new WiredTransport(device);
  if (device.vendorId === IDS.wireless.vendorId && hasOutput(device, 0x13)) return new WirelessTransport(device);
  return null;
}

// Tek seferde bir işlem: HID istekleri üst üste binmesin.
class Queue {
  constructor() { this.tail = Promise.resolve(); }
  run(fn) {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => {});
    return p;
  }
}

class WiredTransport {
  constructor(device) {
    this.device = device;
    this.kind = 'wired';
    this.q = new Queue();
  }
  async open() { if (!this.device.opened) await this.device.open(); }
  async close() { if (this.device.opened) await this.device.close(); }

  frame(op, type, len, data) {
    if (FORBIDDEN_OPS.has(op)) throw new Error(t('err.blocked'));
    const b = new Uint8Array(519);
    b.set([op, type, 0, 1, 0, len & 0xff, len >> 8]);
    if (data) b.set(data, 7);
    return b;
  }
  async rawRead(op, type, len) {
    await this.device.sendFeatureReport(6, this.frame(op, type, len));
    await sleep(20);
    const dv = await this.device.receiveFeatureReport(6);
    let u = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    // Windows'ta Chromium rapor kimliğini (6) verinin başına ekleyebiliyor.
    if (u[0] !== op && u[0] === 6 && u[1] === op) u = u.subarray(1);
    if (u[0] !== op) throw new Error(t('err.unexpected') + ': ' + u[0].toString(16));
    return u.slice(7, 7 + len);
  }
  read(op, type, len) { return this.q.run(() => this.rawRead(op | 0x80, type, len)); }
  write(op, type, data) {
    return this.q.run(async () => {
      await this.device.sendFeatureReport(6, this.frame(op, type, data.length, data));
      await sleep(30);
    });
  }

  readConfig() { return this.read(0x04, 0, SIZES.config); }
  readKeymap(layer) { return this.read(0x03, layer, SIZES.keymap); }
  readColors() { return this.read(0x06, 0, SIZES.colors); }
  readPalette() { return this.read(0x0a, 0, SIZES.palette); }
  writeConfig(d) { return this.writeVerified(0x04, 0, d); }
  writeKeymap(layer, d) { return this.writeVerified(0x03, layer, d); }
  writeColors(d) { return this.writeVerified(0x06, 0, d); }
  writePalette(d) { return this.writeVerified(0x0a, 0, d); }

  async writeVerified(op, type, data) {
    for (let i = 0; i < 3; i++) {
      await this.write(op, type, data);
      const back = await this.read(op, type, data.length);
      if (back.every((v, k) => v === data[k])) return;
    }
    throw new Error(t('err.verify'));
  }
  async info() { return { link: 'USB' }; }
}

class WirelessTransport {
  constructor(device) {
    this.device = device;
    this.kind = 'wireless';
    this.q = new Queue();
    this.waiters = [];
    this.onReport = (e) => {
      if (e.reportId !== 0x13) return;
      const u = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      for (const w of [...this.waiters]) w(u);
    };
    this.reads = {};
  }
  async open() {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener('inputreport', this.onReport);
  }
  async close() {
    this.device.removeEventListener('inputreport', this.onReport);
    if (this.device.opened) await this.device.close();
  }

  packet(cmd, total, idx, b4, data) {
    if (FORBIDDEN_OPS.has(cmd)) throw new Error(t('err.blocked'));
    const p = new Uint8Array(19);
    p.set([cmd, total, idx, b4]);
    if (data) p.set(data, 4);
    let s = 0x13;
    for (let i = 0; i < 18; i++) s += p[i];
    p[18] = s & 0xff;
    return p;
  }
  valid(u) {
    let s = 0x13;
    for (let i = 0; i < 18; i++) s += u[i];
    return (s & 0xff) === u[18];
  }
  // Paket gönderip koşula uyan cevapları toplar.
  exchange(pkt, accept, done, timeout) {
    return new Promise((resolve, reject) => {
      const got = [];
      let timer;
      const finish = (err) => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== on);
        err ? reject(err) : resolve(got);
      };
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => finish(got.length ? null : new Error(t('err.noAnswer'))), timeout); };
      const on = (u) => {
        if (!this.valid(u) || !accept(u)) return;
        got.push(u);
        if (done(got)) finish(); else arm();
      };
      this.waiters.push(on);
      arm();
      this.device.sendReport(0x13, pkt).catch(finish);
    });
  }
  async status() {
    return this.q.run(async () => {
      const [r] = await this.exchange(this.packet(0x07, 1, 0, 0), (u) => u[0] === 0x07, () => true, 500);
      return { online: r[4] === 1 };
    });
  }
  async info() {
    let online = false;
    try { online = (await this.status()).online; } catch (e) { /* cevap yok */ }
    return { link: '2.4G', online };
  }

  readBlob(cmd, b4 = 0) {
    return this.q.run(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        let total = 0;
        const got = await this.exchange(
          this.packet(cmd, 1, 0, b4),
          (u) => u[0] === cmd,
          (g) => { total = g[0][1]; return new Set(g.map((u) => u[2])).size >= total; },
          700,
        ).catch(() => []);
        if (!got.length) continue;
        total = got[0][1];
        const parts = new Map(got.map((u) => [u[2], u.slice(4, 4 + (u[3] & 0x0f))]));
        if (parts.size !== total) continue;
        const out = [];
        for (let i = 0; i < total; i++) out.push(...parts.get(i));
        return new Uint8Array(out);
      }
      throw new Error(t('err.rfRead'));
    });
  }
  writeBlob(cmd, data, layer = 0) {
    return this.q.run(async () => {
      const n = Math.ceil(data.length / 14);
      for (let i = 0; i < n; i++) {
        const chunk = data.subarray(i * 14, i * 14 + 14);
        const pkt = this.packet(cmd, n, i, (layer << 4) | chunk.length, chunk);
        let ok = false;
        for (let attempt = 0; attempt < 4 && !ok; attempt++) {
          const r = await this.exchange(pkt, (u) => u[0] === cmd && u[2] === i, () => true, 400).catch(() => []);
          ok = r.length > 0;
        }
        if (!ok) throw new Error(t('err.rfAck', (i + 1) + '/' + n));
      }
    });
  }

  async tryRead(name, cmd, b4, size) {
    if (this.reads[name] === false) return null;
    try {
      const d = await this.readBlob(cmd, b4);
      if (d.length >= size) { this.reads[name] = true; return d.slice(0, size); }
    } catch (e) { /* desteklenmiyor */ }
    this.reads[name] = false;
    return null;
  }
  async readConfig() {
    const d = await this.readBlob(0x44);
    if (d.length !== SIZES.config) throw new Error(t('err.cfgShort'));
    return d;
  }
  readKeymap(layer) { return this.tryRead('keymap' + layer, 0x41, layer << 4, SIZES.keymap); }
  readColors() { return this.tryRead('colors', 0x42, 0, SIZES.colors); }
  readPalette() { return this.tryRead('palette', 0x49, 0, SIZES.palette); }
  async writeConfig(d) {
    await this.writeBlob(0x04, d);
    const back = await this.readConfig();
    if (!back.every((v, k) => v === d[k])) throw new Error(t('err.verify'));
  }
  writeKeymap(layer, d) { return this.writeBlob(0x01, d, layer); }
  writeColors(d) { return this.writeBlob(0x02, d); }
  writePalette(d) { return this.writeBlob(0x09, d); }
}
