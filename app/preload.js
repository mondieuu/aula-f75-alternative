// Sayfaya yalnızca güncelleme için küçük bir köprü açar.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aulaApp', {
  getUpdate: () => ipcRenderer.invoke('upd:get'),
  checkUpdate: () => ipcRenderer.invoke('upd:check'),
  installUpdate: () => ipcRenderer.invoke('upd:install'),
  openReleases: () => ipcRenderer.invoke('upd:open'),
  onUpdate: (cb) => ipcRenderer.on('upd:state', (_e, s) => cb(s)),
});
