// 브라우저 프로세스 API를 노출하는 preload 스크립트
const { contextBridge, ipcRenderer } = require('electron');

// Expose ipcRenderer to the renderer process
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, func) => {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    },
    once: (channel, func) => {
      ipcRenderer.once(channel, (event, ...args) => func(...args));
    },
    removeListener: (channel, func) => {
      ipcRenderer.removeListener(channel, func);
    }
  }
});

// 레거시 코드 호환을 위해 전역 ipcRenderer도 제공
contextBridge.exposeInMainWorld('ipcRenderer', {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, func) => {
    ipcRenderer.on(channel, (event, ...args) => func(...args));
    return func;
  },
  once: (channel, func) => {
    ipcRenderer.once(channel, (event, ...args) => func(...args));
    return func;
  },
  removeListener: (channel, func) => {
    ipcRenderer.removeListener(channel, func);
  }
});