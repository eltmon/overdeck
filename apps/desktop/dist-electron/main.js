Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let node_fs = require("node:fs");
node_fs = __toESM(node_fs);
let node_path = require("node:path");
node_path = __toESM(node_path);
let electron = require("electron");
//#region src/main.ts
const ROOT_DIR = node_path.resolve(__dirname, "../../..");
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment ? "Panopticon (Dev)" : "Panopticon";
const APP_ID = "com.panopticon.app";
const LINUX_WM_CLASS = isDevelopment ? "panopticon-dev" : "panopticon";
const DESKTOP_SCHEME = "panopticon";
const IPC = {
	GET_SERVER_URL: "pan:get-server-url",
	GET_WS_URL: "pan:get-ws-url",
	PICK_FOLDER: "pan:pick-folder",
	OPEN_EXTERNAL: "pan:open-external",
	MENU_ACTION: "pan:menu-action",
	GET_DESKTOP_SETTINGS: "pan:get-desktop-settings",
	UPDATE_DESKTOP_SETTING: "pan:update-desktop-setting",
	NOTIFY: "pan:notify"
};
let mainWindow = null;
let serverPort = 0;
let serverUrl = "";
let serverWsUrl = "";
let isQuitting = false;
function resolveResourcePath(fileName) {
	const candidates = [
		node_path.join(__dirname, "../resources", fileName),
		node_path.join(process.resourcesPath ?? "", "resources", fileName),
		node_path.join(ROOT_DIR, "apps/desktop/resources", fileName)
	];
	for (const candidate of candidates) if (node_fs.existsSync(candidate)) return candidate;
	return null;
}
function resolveServerEntry() {
	if (!electron.app.isPackaged) return node_path.join(ROOT_DIR, "dist/dashboard/server.js");
	return node_path.join(process.resourcesPath ?? "", "server/server.js");
}
function resolveServerStaticDir() {
	const candidates = [node_path.join(ROOT_DIR, "dist/dashboard/public"), node_path.join(process.resourcesPath ?? "", "server/public")];
	for (const candidate of candidates) if (node_fs.existsSync(node_path.join(candidate, "index.html"))) return candidate;
	return null;
}
function resolveWindowUrl() {
	if (isDevelopment) return process.env.VITE_DEV_SERVER_URL;
	return `${DESKTOP_SCHEME}://app/index.html`;
}
function registerIpcHandlers() {
	electron.ipcMain.on(IPC.GET_SERVER_URL, (event) => {
		event.returnValue = serverUrl;
	});
	electron.ipcMain.on(IPC.GET_WS_URL, (event) => {
		event.returnValue = serverWsUrl;
	});
	electron.ipcMain.handle(IPC.PICK_FOLDER, async () => {
		const { dialog } = await import("electron");
		const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
		return result.canceled ? null : result.filePaths[0] ?? null;
	});
	electron.ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url) => {
		if (typeof url !== "string") return;
		let parsed;
		try {
			parsed = new URL(url);
		} catch {
			return;
		}
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
		await electron.shell.openExternal(parsed.toString());
	});
}
function createWindow() {
	const win = new electron.BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 900,
		minHeight: 600,
		title: APP_DISPLAY_NAME,
		webPreferences: {
			preload: node_path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false
		},
		show: false
	});
	win.once("ready-to-show", () => win.show());
	win.on("close", (event) => {
		if (!isQuitting && process.platform === "darwin") {
			event.preventDefault();
			win.hide();
		}
	});
	win.loadURL(resolveWindowUrl());
	return win;
}
function showOrCreateWindow() {
	const existing = electron.BrowserWindow.getFocusedWindow() ?? mainWindow ?? electron.BrowserWindow.getAllWindows()[0];
	if (existing) {
		if (!existing.isVisible()) existing.show();
		existing.focus();
		return;
	}
	mainWindow = createWindow();
}
function dispatchMenuAction(action) {
	const win = electron.BrowserWindow.getFocusedWindow() ?? mainWindow ?? electron.BrowserWindow.getAllWindows()[0];
	if (!win) {
		showOrCreateWindow();
		setTimeout(() => dispatchMenuAction(action), 500);
		return;
	}
	const send = () => {
		if (win.isDestroyed()) return;
		win.webContents.send(IPC.MENU_ACTION, action);
		if (!win.isVisible()) win.show();
		win.focus();
	};
	if (win.webContents.isLoadingMainFrame()) win.webContents.once("did-finish-load", send);
	else send();
}
electron.protocol.registerSchemesAsPrivileged([{
	scheme: DESKTOP_SCHEME,
	privileges: {
		standard: true,
		secure: true,
		supportFetchAPI: true,
		corsEnabled: true
	}
}]);
if (process.platform === "linux") electron.app.commandLine.appendSwitch("class", LINUX_WM_CLASS);
electron.app.on("ready", () => {
	registerIpcHandlers();
	if (process.platform === "win32") electron.app.setAppUserModelId(APP_ID);
	if (process.platform === "darwin" && electron.app.dock) {
		const iconPath = resolveResourcePath("icon.png");
		if (iconPath) electron.app.dock.setIcon(iconPath);
	}
	serverPort = 7825;
	serverUrl = `http://127.0.0.1:${serverPort}`;
	serverWsUrl = `ws://127.0.0.1:${serverPort}`;
	mainWindow = createWindow();
});
electron.app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		isQuitting = true;
		electron.app.quit();
	}
});
electron.app.on("activate", () => showOrCreateWindow());
electron.app.on("before-quit", () => {
	isQuitting = true;
});
//#endregion
exports.DESKTOP_SCHEME = DESKTOP_SCHEME;
exports.IPC = IPC;
exports.createWindow = createWindow;
exports.dispatchMenuAction = dispatchMenuAction;
Object.defineProperty(exports, "isQuitting", {
	enumerable: true,
	get: function() {
		return isQuitting;
	}
});
exports.resolveResourcePath = resolveResourcePath;
exports.resolveServerEntry = resolveServerEntry;
exports.resolveServerStaticDir = resolveServerStaticDir;
exports.resolveWindowUrl = resolveWindowUrl;
Object.defineProperty(exports, "serverPort", {
	enumerable: true,
	get: function() {
		return serverPort;
	}
});
Object.defineProperty(exports, "serverUrl", {
	enumerable: true,
	get: function() {
		return serverUrl;
	}
});
Object.defineProperty(exports, "serverWsUrl", {
	enumerable: true,
	get: function() {
		return serverWsUrl;
	}
});
exports.showOrCreateWindow = showOrCreateWindow;

//# sourceMappingURL=main.js.map