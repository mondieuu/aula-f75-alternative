// Pil durumu. Klavye 2.4G modundayken alıcıya kendiliğinden 0x0A paketleri gönderir:
// [0A, 01, 00, 04, tür, değer, bayrak]. Tür 05 = pil: değer yüzde (0–100), bayrakta 0x10 = kablo takılı (şarj).
// Tür 02 = bağlantı (1 çevrimiçi). Alıcıya 07/05 sorulunca klavye genelde pil paketini de yollar.
// USB modunda firmware yüzdeyi vermez; o zaman son bilinen değer gösterilir.

class BatteryMonitor {
  constructor(onChange) {
    this.onChange = onChange;
    this.dev = null;
    this.timer = 0;
    this.state = BatteryMonitor.load();
    this.live = false;
    this.handler = (e) => {
      if (e.reportId !== 0x13) return;
      const u = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      if (u[0] !== 0x0a) return;
      if (u[4] === 0x05 && u[5] <= 100) {
        this.live = true;
        this.state = { level: u[5], charging: !!(u[6] & 0x10), t: Date.now() };
        BatteryMonitor.save(this.state);
        this.onChange();
      } else if (u[4] === 0x02 && u[5] === 0) {
        this.live = false;
        this.onChange();
      }
    };
  }
  static load() { try { return JSON.parse(localStorage.getItem('aulaBattery')) || null; } catch { return null; } }
  static save(s) { try { localStorage.setItem('aulaBattery', JSON.stringify(s)); } catch { /* yok */ } }

  // send: alıcıya paket göndermek için (ana bağlantı kablosuzsa onun kuyruğu kullanılır)
  async attach(device, send) {
    if (this.dev === device) return;
    this.detach();
    this.dev = device;
    if (!device.opened) await device.open();
    device.addEventListener('inputreport', this.handler);
    const ask = () => send(0x07).then(() => send(0x05)).catch(() => {});
    ask();
    this.timer = setInterval(() => { if (!document.hidden) ask(); }, 15000);
  }
  detach() {
    clearInterval(this.timer);
    if (this.dev) this.dev.removeEventListener('inputreport', this.handler);
    this.dev = null;
    this.live = false;
  }
}

// Alıcıya tek bir sorgu paketi gönderir (yazma yapmaz)
function dongleQuery(device, cmd) {
  const p = new Uint8Array(19);
  p[0] = cmd; p[1] = 1;
  let s = 0x13;
  for (let i = 0; i < 18; i++) s += p[i];
  p[18] = s & 0xff;
  return device.sendReport(0x13, p);
}

function batteryIcon(level, charging) {
  const w = level == null ? 0 : Math.max(1.5, (Math.min(100, level) / 100) * 13);
  const low = level != null && level <= 15 && !charging;
  return `<svg class="bat${low ? ' low' : ''}" viewBox="0 0 24 24"><rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>` +
    `<rect class="bat-fill" x="4" y="9" width="${w.toFixed(1)}" height="6" rx="1"/>` +
    (charging ? '<path class="bat-bolt' + (level == null ? ' solo' : '') + '" d="m11.5 8.5-2.5 3.5h3l-2.5 3.5"/>' : '') + '</svg>';
}
