/**
 * Exposes `window.mesh` to the renderer. The bridge itself is built in
 * src/main/ipc.ts next to the main side of the same channels, so both halves
 * are tested together.
 */
import { contextBridge, ipcRenderer } from "electron";
import { createMeshBridge } from "../main/ipc";

contextBridge.exposeInMainWorld("mesh", createMeshBridge(ipcRenderer, process.platform));
