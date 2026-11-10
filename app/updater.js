// Güncelleme: GitHub Releases'teki son sürümü denetler, arka planda indirir
// ve kullanıcıya yeniden başlatmayı önerir. Sadece kurulu (paketlenmiş) uygulamada çalışır.
const { app, dialog } = require('electron');

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

function initUpdater(getWindow) {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('updater unavailable:', err);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let asked = false;
  autoUpdater.on('error', (err) => console.error('update error:', err && err.message));
  autoUpdater.on('update-downloaded', async (info) => {
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

  const check = () => autoUpdater.checkForUpdates().catch((err) => console.error('update check failed:', err && err.message));
  check();
  setInterval(check, CHECK_EVERY_MS).unref();
}

module.exports = { initUpdater };
