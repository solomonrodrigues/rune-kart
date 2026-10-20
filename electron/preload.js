const { contextBridge, ipcRenderer } = require('electron');

// Only the launcher page uses this; the game itself runs as a normal web page served by the host.
contextBridge.exposeInMainWorld('runeKart', {
  host: () => ipcRenderer.invoke('host'),
  join: address => ipcRenderer.invoke('join', address),
});
