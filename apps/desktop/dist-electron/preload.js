let electron = require("electron");
//#region src/preload.ts
/**
* Preload script for the Overdeck Electron renderer.
*
* Exposes `window.panopticonBridge` via contextBridge.exposeInMainWorld.
* The renderer uses this bridge to communicate with the main process over IPC.
*
* Security model:
*   - contextIsolation: true — renderer JS cannot access Node.js APIs
*   - sandbox: false — allows contextBridge to expose typed APIs
*   - All IPC channels are explicitly listed; no dynamic channel names
*   - External URL validation happens in the main process (ipcMain.handle)
*/
const IPC = {
	GET_SERVER_URL: "pan:get-server-url",
	GET_WS_URL: "pan:get-ws-url",
	PICK_FOLDER: "pan:pick-folder",
	OPEN_EXTERNAL: "pan:open-external",
	OPEN_TERMINAL_WINDOW: "pan:open-terminal-window",
	SET_ALWAYS_ON_TOP: "pan:set-always-on-top",
	MENU_ACTION: "pan:menu-action",
	GET_DESKTOP_SETTINGS: "pan:get-desktop-settings",
	UPDATE_DESKTOP_SETTING: "pan:update-desktop-setting",
	NOTIFY: "pan:notify"
};
electron.contextBridge.exposeInMainWorld("panopticonBridge", {
	isDesktopApp: () => true,
	getServerUrl: () => {
		const result = electron.ipcRenderer.sendSync(IPC.GET_SERVER_URL);
		return typeof result === "string" ? result : null;
	},
	getWsUrl: () => {
		const result = electron.ipcRenderer.sendSync(IPC.GET_WS_URL);
		return typeof result === "string" ? result : null;
	},
	pickFolder: () => electron.ipcRenderer.invoke(IPC.PICK_FOLDER),
	openExternal: (url) => electron.ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
	openTerminalWindow: (sessionName, title) => {
		electron.ipcRenderer.send(IPC.OPEN_TERMINAL_WINDOW, sessionName, title);
	},
	setAlwaysOnTop: (value) => {
		electron.ipcRenderer.send(IPC.SET_ALWAYS_ON_TOP, value);
	},
	onMenuAction: (listener) => {
		const wrapped = (_event, action) => {
			if (typeof action === "string") listener(action);
		};
		electron.ipcRenderer.on(IPC.MENU_ACTION, wrapped);
		return () => electron.ipcRenderer.removeListener(IPC.MENU_ACTION, wrapped);
	},
	getDesktopSettings: () => electron.ipcRenderer.invoke(IPC.GET_DESKTOP_SETTINGS),
	updateDesktopSetting: (key, value) => electron.ipcRenderer.invoke(IPC.UPDATE_DESKTOP_SETTING, key, value),
	notify: (eventType, title, body) => electron.ipcRenderer.invoke(IPC.NOTIFY, eventType, title, body)
});
//#endregion

//# sourceMappingURL=preload.js.map