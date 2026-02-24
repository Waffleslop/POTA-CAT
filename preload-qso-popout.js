const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getAllQsos: () => ipcRenderer.invoke('get-all-qsos'),
  updateQso: (data) => ipcRenderer.invoke('update-qso', data),
  deleteQso: (idx) => ipcRenderer.invoke('delete-qso', idx),
  exportAdif: (qsos) => ipcRenderer.invoke('export-adif', qsos),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getDefaultLogPath: () => ipcRenderer.invoke('get-default-log-path'),
  onQsoAdded: (cb) => ipcRenderer.on('qso-popout-added', (_e, qso) => cb(qso)),
  onQsoUpdated: (cb) => ipcRenderer.on('qso-popout-updated', (_e, data) => cb(data)),
  onQsoDeleted: (cb) => ipcRenderer.on('qso-popout-deleted', (_e, idx) => cb(idx)),
  onTheme: (cb) => ipcRenderer.on('qso-popout-theme', (_e, theme) => cb(theme)),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  minimize: () => ipcRenderer.send('qso-popout-minimize'),
  maximize: () => ipcRenderer.send('qso-popout-maximize'),
  close: () => ipcRenderer.send('qso-popout-close'),
});
