'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openInput: () => ipcRenderer.invoke('dialog:openInput'),
  openFolder: (defaultPath) => ipcRenderer.invoke('dialog:openFolder', defaultPath),
  analyze: (text) => ipcRenderer.invoke('rapid:analyze', text),
  transform: (text, options) => ipcRenderer.invoke('rapid:transform', { text, options }),
  save: (folder, sourceName, content) => ipcRenderer.invoke('file:save', { folder, sourceName, content }),
  reveal: (filePath) => ipcRenderer.invoke('shell:reveal', filePath)
});
