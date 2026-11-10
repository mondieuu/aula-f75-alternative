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
  },
};
// Basma: 0x4444'te 'mov a,#kod' (74 xx), ardından f0
const KNOB_PRESS = { at: 0x4445, modes: { mute: 0xe2, play: 0xcd } };
const hexBytes = (h) => h.match(/../g).map((x) => parseInt(x, 16));

function knobState(fw) {
  const blk = fw.subarray(KNOB_ROTATE.at, KNOB_ROTATE.at + 23);
  const rotate = Object.keys(KNOB_ROTATE.modes).find((m) => hexBytes(KNOB_ROTATE.modes[m]).every((v, i) => v === blk[i])) || null;
  const ctx = fw[KNOB_PRESS.at - 1] === 0x74 && fw[KNOB_PRESS.at + 1] === 0xf0;
  const press = ctx ? Object.keys(KNOB_PRESS.modes).find((m) => KNOB_PRESS.modes[m] === fw[KNOB_PRESS.at]) || null : null;
  return { rotate, press };
}

function knobPatchable(fw) {
  if (fw.length !== ISP.FW_SIZE || fw[0] !== 0x02) return false;
  const st = knobState(fw);
  return !!(st.rotate && st.press);
}

function applyKnob(fw, rotate, press) {
  const out = new Uint8Array(fw);
  out.set(hexBytes(KNOB_ROTATE.modes[rotate]), KNOB_ROTATE.at);
  out[KNOB_PRESS.at] = KNOB_PRESS.modes[press];
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
