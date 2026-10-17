/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

// Never expose IPC itself or credentials to the renderer.
if (process.isMainFrame) contextBridge.exposeInMainWorld('jimmyDesktop', {
  getState: () => ipcRenderer.invoke('jimmy:state'),
  expand: value => ipcRenderer.invoke('jimmy:expand', Boolean(value)),
  mute: value => ipcRenderer.invoke('jimmy:mute', Boolean(value)),
  hide: () => ipcRenderer.invoke('jimmy:hide'),
  captureScreen: () => ipcRenderer.invoke('jimmy:capture-screen'),
  wake: () => ipcRenderer.invoke('jimmy:wake'),
  shutdown: () => ipcRenderer.invoke('jimmy:shutdown'),
  openCanvas: session => ipcRenderer.invoke('jimmy:open-canvas', session),
  closeCanvas: () => ipcRenderer.invoke('jimmy:close-canvas'),
  setAssistantName: name => ipcRenderer.invoke('jimmy:assistant-name', name),
  onOpenCanvas: callback => {
    const listener = () => callback();
    ipcRenderer.on('jimmy:show-canvas', listener);
    return () => ipcRenderer.removeListener('jimmy:show-canvas', listener);
  },
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('jimmy:state-changed', listener);
    return () => ipcRenderer.removeListener('jimmy:state-changed', listener);
  },
});
