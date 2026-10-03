import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('flick', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, fn: (...args: unknown[]) => void) => {
    const listener = (_e: unknown, ...args: unknown[]) => fn(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})
