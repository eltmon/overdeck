let electron = require("electron");
//#region src/connect-preload.ts
/**
* Preload script for the connect window (PAN-4402 W-5).
*
* Exposes `window.overdeckConnect`. The window runs sandboxed with context
* isolation; every call is a fixed-channel ipcRenderer.invoke, and the main
* process answers only this window's webContents.
*/
const CONNECT_IPC = {
	GET_STATE: "pan:connect-get-state",
	PAIR: "pan:connect-pair",
	OPEN_MACHINE: "pan:connect-open-machine",
	USE_LOCAL: "pan:connect-use-local",
	FORGET: "pan:connect-forget",
	STATE_CHANGED: "pan:connect-state-changed"
};
electron.contextBridge.exposeInMainWorld("overdeckConnect", {
	getState: () => electron.ipcRenderer.invoke(CONNECT_IPC.GET_STATE),
	pair: (link) => electron.ipcRenderer.invoke(CONNECT_IPC.PAIR, link),
	openMachine: () => electron.ipcRenderer.invoke(CONNECT_IPC.OPEN_MACHINE),
	useThisComputer: () => electron.ipcRenderer.invoke(CONNECT_IPC.USE_LOCAL),
	forget: () => electron.ipcRenderer.invoke(CONNECT_IPC.FORGET),
	onStateChanged: (callback) => {
		electron.ipcRenderer.on(CONNECT_IPC.STATE_CHANGED, () => callback());
	}
});
//#endregion

//# sourceMappingURL=connect-preload.js.map