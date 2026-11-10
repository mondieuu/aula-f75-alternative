// Güncelleme: GitHub Releases'teki son sürümü denetler.
// Kurulu (paketlenmiş) uygulama: açılışta ve 6 saatte bir denetler, arka planda indirir,
// Ayarlar sayfası durumu gösterir ve "Yeniden başlat" ile kurar.
// Kaynaktan çalışırken: yalnızca Ayarlar'da "Denetle"ye basınca GitHub'a bakar ve
// yeni sürüm varsa indirme sayfasını açar (kendiliğinden ağa çıkmaz).
const { app, dialog, ipcMain, shell, net } = require('electron');

const REPO = 'mondieuu/aula-f75-alternative';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const TEXT = {
  tr: {
    title: 'Güncelleme hazır',
    message: (v) => `AULA F75 ${v} indirildi.`,
    detail: 'Şimdi yeniden başlatırsan güncelleme kurulur. Firmware yazıyorsan önce bitmesini bekle. "Sonra" dersen uygulamayı kapattığında kurulur.',
    now: 'Yeniden başlat',
    later: 'Sonra',
  },
  en: {
    title: 'Update ready',
    message: (v) => `AULA F75 ${v} has been downloaded.`,
    detail: 'Restart now to install it. If you are writing firmware, let it finish first. If you choose "Later", it installs when you close the app.',
    now: 'Restart',
    later: 'Later',
  },
};

// 1.2.0 > 1.1.9 gibi basit sürüm karşılaştırması
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function initUpdater(getWindow) {
  // phase: idle | checking | none | available | downloading | ready | error
  const state = { version: app.getVersion(), packaged: app.isPackaged, phase: 'idle', latest: null, percent: 0, error: null, checkedAt: null };
  const set = (patch) => {
    Object.assign(state, patch);
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('upd:state', state);
  };

  let autoUpdater = null;
  if (app.isPackaged) {
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (err) {
      console.error('updater unavailable:', err);
    }
  }

  // Kaynaktan çalışırken: GitHub API'den son sürüm numarası
  async function checkManual() {
    set({ phase: 'checking', error: null });
    try {
      const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'aula-f75-alternative' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rel = await res.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      set({ phase: newer(latest, state.version) ? 'available' : 'none', latest, checkedAt: Date.now() });
    } catch (err) {
      set({ phase: 'error', error: err && err.message, checkedAt: Date.now() });
    }
  }

  async function check() {
    if (!autoUpdater) return checkManual();
    if (state.phase === 'downloading' || state.phase === 'ready') return;
    set({ phase: 'checking', error: null });
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      set({ phase: 'error', error: err && err.message, checkedAt: Date.now() });
    }
  }

  ipcMain.handle('upd:get', () => state);
  ipcMain.handle('upd:check', () => check());
  ipcMain.handle('upd:install', () => { if (autoUpdater && state.phase === 'ready') autoUpdater.quitAndInstall(); });
  ipcMain.handle('upd:open', () => shell.openExternal(RELEASES));

  if (!autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let asked = false;
  autoUpdater.on('error', (err) => { console.error('update error:', err && err.message); set({ phase: 'error', error: err && err.message }); });
  autoUpdater.on('update-available', (info) => set({ phase: 'downloading', latest: info.version, percent: 0, checkedAt: Date.now() }));
  autoUpdater.on('update-not-available', (info) => set({ phase: 'none', latest: info && info.version, checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ phase: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', async (info) => {
    set({ phase: 'ready', latest: info.version, percent: 100 });
    if (asked) return;
    asked = true;
    const t = /^tr/i.test(app.getSystemLocale()) ? TEXT.tr : TEXT.en;
    const options = {
      type: 'info',
      title: t.title,
      message: t.message(info.version),
      detail: t.detail,
      buttons: [t.now, t.later],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const win = getWindow();
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (response === 0) autoUpdater.quitAndInstall();
  });

  check();
  setInterval(check, CHECK_EVERY_MS).unref();
}

module.exports = { initUpdater };
