import { contextBridge, ipcRenderer } from "electron";
import type { MeshApi } from "@shared/types";

const api: MeshApi = {
  platform: process.platform,
  startLogin: (login) => ipcRenderer.invoke("start-login", login),
  verify: (code) => ipcRenderer.invoke("verify", code),
  load: () => ipcRenderer.invoke("load"),
  logout: () => ipcRenderer.invoke("logout"),
  sessionStorage: () => ipcRenderer.invoke("session-storage"),
  setTitlebarColors: (colors) => ipcRenderer.send("set-titlebar-colors", colors),
};

contextBridge.exposeInMainWorld("mesh", api);
