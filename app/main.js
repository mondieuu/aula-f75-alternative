// AULA F75 masaüstü uygulaması: web arayüzünü kendi penceresinde açar.
// Tarayıcının cihaz seçme penceresi yerine AULA cihazlarını kendisi seçer.
const { app, BrowserWindow, session, nativeTheme, shell } = require('electron');
const path = require('path');

// Sadece bu cihazlara izin verilir: kablolu klavye, 2.4G alıcı, firmware yükleyicisi
const ALLOWED = [0x258a, 0x3554, 0x0603];
const PREFER = [0x258a, 0x0603, 0x3554];
const PAGE = path.join(__dirname, '..', 'index.html');

app.setName('AULA F75');
app.setAppUserModelId('aula-f75-web');
// Gereksiz arka plan işlerini kapat (az RAM)
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,CalculateNativeWinOcclusion');
// Arayüz dili ilk açılışta Türkçe (uygulama içinden değiştirilebilir)
app.commandLine.appendSwitch('lang', 'tr');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    const ses = session.defaultSession;
    const isOurPage = (url) => typeof url === 'string' && url.startsWith('file://');
    ses.setPermissionRequestHandler((wc, perm, cb) => cb(false));
    ses.setPermissionCheckHandler((wc, perm, origin) => perm === 'hid' && isOurPage(origin || (wc && wc.getURL())));
    ses.setDevicePermissionHandler((d) => d.deviceType === 'hid' && ALLOWED.includes(d.device.vendorId));
    ses.on('select-hid-device', (event, details, callback) => {
      event.preventDefault();
      const list = details.deviceList.filter((d) => ALLOWED.includes(d.vendorId));
      list.sort((a, b) => PREFER.indexOf(a.vendorId) - PREFER.indexOf(b.vendorId));
      callback(list.length ? list[0].deviceId : '');
    });

    win = new BrowserWindow({
      width: 1400, height: 960, minWidth: 980, minHeight: 640,
      title: 'AULA F75',
      icon: path.join(__dirname, 'icon.ico'),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#141415' : '#f6f6f7',
      autoHideMenuBar: true,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    });
    win.setMenu(null);
    win.once('ready-to-show', () => win.show());
    // Sayfa dışına gezinme yok; dış bağlantılar varsayılan tarayıcıda açılır
    win.webContents.on('will-navigate', (e, url) => { if (!isOurPage(url)) { e.preventDefault(); shell.openExternal(url); } });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.loadFile(PAGE);
    win.on('closed', () => { win = null; });
  });

  app.on('window-all-closed', () => app.quit());
}
