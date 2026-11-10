// Firmware okuma/yazma: Sinowealth ISP yükleyicisi (SH68F90A).
// Protokol: github.com/carlossless/sinowealth-kb-tool (MIT, Karolis Stasaitis).
// Yükleyici bölümüne (son 4 KB) hiçbir zaman yazılmaz. Yazılan veri geri okunup
// doğrulanmadan firmware etkinleştirilmez; doğrulama başarısızsa klavye yükleyici
// modunda kalır ve orijinal dosya yeniden yazılabilir.

const ISP = { vendorId: 0x0603, productId: 0x1020, FW_SIZE: 61440, PAGE: 2048 };

// Tekerlek yaması (V11). Dönüş kodu 0x38BA'da 23 bayt: ses / parça / ışık.
// Işık modu klavyenin kendi parlaklık rutinini (0x8C0F, FN + ↑/↓ ile aynı) çağırır.
const KNOB_ROTATE = {
  at: 0x38ba,
  modes: {
    volume: '9009bd302f0474e9800274eaf0e4a3f0d250d22d786ff6',
    track: '9009bd302f0474b5800274b6f0e4a3f0d250d22d786ff6',
    light: '900d15e4f0a37402302f0114f0a3a37408f0c242128c0f',
    // Ölçüm: ses bloğu, kodlar 0x10 / 0x11 (ayrılmış, Windows yok sayar); uygulama tıkları sayar
    measure: '9009bd302f047410800274' + '11' + 'f0e4a3f0d250d22d786ff6',
  },
};
// Basma: 0x4444'te 'mov a,#kod' (74 xx), ardından f0
const KNOB_PRESS = { at: 0x4445, modes: { mute: 0xe2, play: 0xcd } };
const hexBytes = (h) => h.match(/../g).map((x) => parseInt(x, 16));
const same = (fw, at, bytes) => bytes.every((v, i) => fw[at + i] === v);

// Hassasiyet: kaç tıkta bir işlem yapılacağı. 0x38AF'deki 11 baytlık olay denetimi,
// kodun bittiği boş alandaki (0xEFC4) bir sayaca çağrıya dönüşür. Sayaç XRAM 0x0FF8'de,
// son yön 0x0FF9'da (açılışta firmware tüm XRAM'i sıfırlar, bu adresleri başka kod kullanmaz).
// Yön değişince sayaç sıfırlanır. 1 tık = fabrika kodu (yama yok).
const KNOB_SPEED = {
  at: 0x38af,
  cave: 0xefc4,
  caveSize: 50,
  orig: hexBytes('302e1f202d1c205019c22e'),
  hook: hexBytes('12efc4501d000000000000'),
  nAt: 0x27,
  code: (n) => hexBytes('302e2d202d2a205027c22e900ff9e0302f026401600be4a22f33f0e4900ff88004900ff8e004b4' +
    n.toString(16).padStart(2, '0') + '004004e4f0d322f0c322'),
  options: [1, 3, 6, 12],
  max: 24,
};

function knobSpeed(fw) {
  if (same(fw, KNOB_SPEED.at, KNOB_SPEED.orig) && fw.subarray(KNOB_SPEED.cave, KNOB_SPEED.cave + KNOB_SPEED.caveSize).every((v) => v === 0)) return 1;
  if (!same(fw, KNOB_SPEED.at, KNOB_SPEED.hook)) return null;
  const n = fw[KNOB_SPEED.cave + KNOB_SPEED.nAt];
  return n >= 2 && n <= KNOB_SPEED.max && same(fw, KNOB_SPEED.cave, KNOB_SPEED.code(n)) ? n : null;
}

function knobState(fw) {
  const blk = fw.subarray(KNOB_ROTATE.at, KNOB_ROTATE.at + 23);
  const rotate = Object.keys(KNOB_ROTATE.modes).find((m) => hexBytes(KNOB_ROTATE.modes[m]).every((v, i) => v === blk[i])) || null;
  const ctx = fw[KNOB_PRESS.at - 1] === 0x74 && fw[KNOB_PRESS.at + 1] === 0xf0;
  const press = ctx ? Object.keys(KNOB_PRESS.modes).find((m) => KNOB_PRESS.modes[m] === fw[KNOB_PRESS.at]) || null : null;
  return { rotate, press, speed: knobSpeed(fw) };
}

function knobPatchable(fw) {
  if (fw.length !== ISP.FW_SIZE || fw[0] !== 0x02) return false;
  const st = knobState(fw);
  return !!(st.rotate && st.press && st.speed);
}

function applyKnob(fw, rotate, press, speed = 1) {
  const out = new Uint8Array(fw);
  out.set(hexBytes(KNOB_ROTATE.modes[rotate]), KNOB_ROTATE.at);
  out[KNOB_PRESS.at] = KNOB_PRESS.modes[press];
  if (speed > 1) {
    out.set(KNOB_SPEED.hook, KNOB_SPEED.at);
    out.set(KNOB_SPEED.code(speed), KNOB_SPEED.cave);
  } else {
    out.set(KNOB_SPEED.orig, KNOB_SPEED.at);
    out.fill(0, KNOB_SPEED.cave, KNOB_SPEED.cave + KNOB_SPEED.caveSize);
  }
  return out;
}

// Çalışan klavyeyi yükleyici moduna alır (feature report 5, komut 0x75).
async function enterIsp(device) {
  if (!device.collections.some((c) => (c.featureReports || []).some((r) => r.reportId === 5))) {
    throw new Error(t('err.noIsp'));
  }
  try { await device.sendFeatureReport(5, new Uint8Array([0x75, 0, 0, 0, 0])); } catch (e) { /* klavye hemen kopabilir */ }
}

class IspDevice {
  constructor(device) { this.d = device; }
  async open() { if (!this.d.opened) await this.d.open(); }
  async close() { if (this.d.opened) await this.d.close().catch(() => {}); }
  cmd(c, lo = 0, hi = 0) { return this.d.sendFeatureReport(5, new Uint8Array([c, lo, hi, 0, 0])); }
  async readPage() {
    const dv = await this.d.receiveFeatureReport(6);
    let u = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    if (u[0] === 6 && u[1] === 0x72) u = u.subarray(1);
    if (u[0] !== 0x72 || u.length < ISP.PAGE + 1) throw new Error(t('err.ispAnswer'));
    return u.slice(1, 1 + ISP.PAGE);
  }
  async readRaw(start, len, progress) {
    await this.cmd(0x52, start & 0xff, start >> 8);
    const out = new Uint8Array(len);
    for (let i = 0; i < len / ISP.PAGE; i++) {
      out.set(await this.readPage(), i * ISP.PAGE);
      progress && progress(i + 1, len / ISP.PAGE);
    }
    return out;
  }
  async readFirmware(progress) {
    await this.cmd(0x55);
    return this.readRaw(0, ISP.FW_SIZE, progress);
  }
  async writeFirmware(image, progress) {
    if (image.length !== ISP.FW_SIZE || image[0] !== 0x02) throw new Error(t('err.badFw'));
    const fw = new Uint8Array(image);
    fw.copyWithin(ISP.FW_SIZE - 4, 1, 3);
    await this.cmd(0x45);
    await new Promise((r) => setTimeout(r, 2000));
    await this.cmd(0x57);
    const n = ISP.FW_SIZE / ISP.PAGE;
    for (let i = 0; i < n; i++) {
      const pkt = new Uint8Array(ISP.PAGE + 1);
      pkt[0] = 0x77;
      pkt.set(fw.subarray(i * ISP.PAGE, (i + 1) * ISP.PAGE), 1);
      await this.d.sendFeatureReport(6, pkt);
      progress && progress(i + 1, n * 2);
    }
    fw.fill(0, ISP.FW_SIZE - 4, ISP.FW_SIZE - 2);
    const back = await this.readRaw(0, ISP.FW_SIZE, (i) => progress && progress(n + i, n * 2));
    for (let i = 0; i < fw.length; i++) {
      if (back[i] !== fw[i]) {
        throw new Error(t('err.fwVerify', i.toString(16)));
      }
    }
    await this.cmd(0x55);
  }
  async reboot() { try { await this.cmd(0x5a); } catch (e) { /* kopma beklenir */ } }
}

async function findIsp() {
  const devs = await navigator.hid.getDevices();
  return devs.find((d) => d.vendorId === ISP.vendorId && d.productId === ISP.productId) || null;
}
async function requestIsp() {
  const [d] = await navigator.hid.requestDevice({ filters: [{ vendorId: ISP.vendorId, productId: ISP.productId }] });
  return d || null;
}
