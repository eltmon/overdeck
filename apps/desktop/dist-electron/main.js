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
let node_child_process = require("node:child_process");
node_child_process = __toESM(node_child_process);
let node_crypto = require("node:crypto");
node_crypto = __toESM(node_crypto);
//#region src/settings.ts
/**
* Desktop-specific settings, persisted to userData/desktop-settings.json.
*
* Covers: tray appearance, per-event notification toggles, auto-start config.
* Loaded at app startup; updated via IPC from renderer.
*/
const DEFAULTS = {
	tray: {
		showBadge: true,
		tooltipDetail: "full"
	},
	notifications: {
		inputNeeded: true,
		stuckAgents: true,
		mergeFailures: true,
		workComplete: true,
		planningDone: false,
		mergeReady: true
	},
	autoStart: {
		enabled: false,
		nagCount: 0,
		nagDismissed: false
	}
};
let settings = deepClone(DEFAULTS);
function deepClone(obj) {
	return JSON.parse(JSON.stringify(obj));
}
function settingsPath() {
	return node_path.join(electron.app.getPath("userData"), "desktop-settings.json");
}
function loadDesktopSettings() {
	try {
		const raw = node_fs.readFileSync(settingsPath(), "utf8");
		const parsed = JSON.parse(raw);
		settings = {
			tray: {
				...DEFAULTS.tray,
				...parsed.tray
			},
			notifications: {
				...DEFAULTS.notifications,
				...parsed.notifications
			},
			autoStart: {
				...DEFAULTS.autoStart,
				...parsed.autoStart
			}
		};
	} catch {
		settings = deepClone(DEFAULTS);
	}
}
function saveDesktopSettings() {
	try {
		node_fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
	} catch {
		console.error("[desktop] failed to save desktop settings");
	}
}
function getDesktopSettings() {
	return settings;
}
/**
* Update a single setting by dotted key (e.g. "notifications.inputNeeded").
* Returns true if the key was found and updated.
*/
function updateDesktopSetting(key, value) {
	const [section, field] = key.split(".");
	if (!section || !field) return false;
	const s = settings;
	if (!s[section] || !(field in s[section])) return false;
	s[section][field] = value;
	saveDesktopSettings();
	return true;
}
//#endregion
//#region src/tray.ts
let tray = null;
let pollTimer = null;
const STATUS_COLORS = {
	idle: "#22c55e",
	working: "#f59e0b",
	attention: "#ef4444"
};
function createTrayIcon(status) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
    <circle cx="8" cy="8" r="7" fill="${STATUS_COLORS[status]}" stroke="#00000033" stroke-width="0.5"/>
    <ellipse cx="8" cy="8" rx="5.5" ry="3.8" stroke="#ffffff44" stroke-width="0.5" fill="none"/>
    <circle cx="8" cy="8" r="2" fill="#ffffff99"/>
    <circle cx="8" cy="8" r="1" fill="#00000066"/>
  </svg>`;
	return electron.nativeImage.createFromBuffer(Buffer.from(svg));
}
function buildTooltip(agentCount, attentionCount, lastActivity) {
	if (getDesktopSettings().tray.tooltipDetail === "minimal") return `Panopticon — ${agentCount} agent${agentCount !== 1 ? "s" : ""}`;
	const lines = ["Panopticon"];
	lines.push(`${agentCount} agent${agentCount !== 1 ? "s" : ""} running`);
	if (attentionCount > 0) lines.push(`⚠ ${attentionCount} need${attentionCount !== 1 ? "" : "s"} attention`);
	if (lastActivity) lines.push(`Last: ${lastActivity}`);
	return lines.join("\n");
}
function buildContextMenu() {
	return electron.Menu.buildFromTemplate([
		{
			label: "Show Dashboard",
			click: () => showOrCreateWindow()
		},
		{ type: "separator" },
		{
			label: "Start Cloister",
			click: () => callServerApi("/api/cloister/start", "POST")
		},
		{
			label: "Stop Cloister",
			click: () => callServerApi("/api/cloister/stop", "POST")
		},
		{
			label: "Emergency Stop All",
			click: () => callServerApi("/api/agents/emergency-stop", "POST")
		},
		{ type: "separator" },
		{
			label: "Settings",
			click: () => {
				showOrCreateWindow();
				dispatchMenuAction("open-settings");
			}
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				electron.app.quit();
			}
		}
	]);
}
async function refreshTrayStatus() {
	if (!tray || isQuitting) return;
	const url = serverUrl;
	if (!url) return;
	try {
		const resp = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3e3) });
		if (!resp.ok) return;
		const data = await resp.json();
		const agentCount = data.agentCount ?? 0;
		const attentionCount = data.attentionCount ?? 0;
		const lastActivity = data.lastActivity ?? null;
		const status = attentionCount > 0 ? "attention" : agentCount > 0 ? "working" : "idle";
		tray.setImage(createTrayIcon(status));
		tray.setToolTip(buildTooltip(agentCount, attentionCount, lastActivity));
		tray.setContextMenu(buildContextMenu());
		if (getDesktopSettings().tray.showBadge && process.platform === "darwin" && electron.app.dock) electron.app.dock.setBadge(agentCount > 0 ? String(agentCount) : "");
	} catch {}
}
function createTray() {
	if (tray) return;
	tray = new electron.Tray(createTrayIcon("idle"));
	tray.setToolTip("Panopticon");
	tray.setContextMenu(buildContextMenu());
	tray.on("click", () => showOrCreateWindow());
	pollTimer = setInterval(() => void refreshTrayStatus(), 5e3);
	refreshTrayStatus();
}
function destroyTray() {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
	tray?.destroy();
	tray = null;
}
//#endregion
//#region src/server.ts
/**
* Embedded dashboard server management.
*
* Spawns dist/dashboard/server.js (or the packaged equivalent) as a child
* process, passing config via environment variables. Supports exponential-
* backoff restart on crash. Graceful shutdown on app quit.
*
* Bootstrap config passed via env vars:
*   PANOPTICON_PORT        — TCP port for HTTP + WS
*   PANOPTICON_AUTH_TOKEN  — random hex token (future: auth middleware)
*   PANOPTICON_MODE        — "desktop" (enables desktop-specific behaviours)
*   PANOPTICON_NO_BROWSER  — "1" (suppresses auto browser open)
*/
const BASE_PORT = 7825;
const MAX_RESTART_DELAY_MS = 3e4;
const SIGTERM_GRACE_MS = 3e3;
let serverProcess = null;
let restartAttempt = 0;
let restartTimer = null;
let quitting = false;
let onReadyCallback = null;
function randomHex(bytes) {
	return node_crypto.randomBytes(bytes).toString("hex");
}
function resolvePort() {
	return BASE_PORT + restartAttempt % 10;
}
function startServer(onReady) {
	onReadyCallback = onReady;
	spawnServer();
}
function spawnServer() {
	if (quitting) return;
	const entry = resolveServerEntry();
	if (!node_fs.existsSync(entry)) {
		console.error(`[desktop/server] Server entry not found: ${entry}`);
		console.error("[desktop/server] Run 'npm run build' to build the dashboard server first.");
		return;
	}
	const port = resolvePort();
	const authToken = randomHex(32);
	const child = node_child_process.spawn(process.execPath, [entry], {
		env: {
			...process.env,
			PANOPTICON_PORT: String(port),
			PANOPTICON_AUTH_TOKEN: authToken,
			PANOPTICON_MODE: "desktop",
			PANOPTICON_NO_BROWSER: "1",
			TERM: process.env.TERM || "xterm-256color",
			COLORTERM: process.env.COLORTERM || "truecolor",
			LANG: process.env.LANG || "en_US.UTF-8",
			ELECTRON_RUN_AS_NODE: void 0
		},
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		]
	});
	serverProcess = child;
	child.stdout?.on("data", (chunk) => {
		process.stdout.write(`[server] ${chunk}`);
	});
	child.stderr?.on("data", (chunk) => {
		process.stderr.write(`[server] ${chunk}`);
	});
	child.on("spawn", () => {
		console.log(`[desktop/server] spawned pid=${child.pid} port=${port}`);
		waitForServer(`http://127.0.0.1:${port}`, () => {
			console.log(`[desktop/server] ready on port ${port}`);
			onReadyCallback?.(port, `ws://127.0.0.1:${port}`);
		});
	});
	child.on("exit", (code, signal) => {
		serverProcess = null;
		console.warn(`[desktop/server] exited code=${String(code)} signal=${String(signal)}`);
		if (!quitting) scheduleRestart();
	});
	child.on("error", (err) => {
		console.error("[desktop/server] spawn error:", err);
		serverProcess = null;
		if (!quitting) scheduleRestart();
	});
}
function waitForServer(url, callback, maxMs = 3e4) {
	const start = Date.now();
	const interval = setInterval(() => {
		if (Date.now() - start > maxMs) {
			clearInterval(interval);
			callback();
			return;
		}
		fetch(url + "/api/health", { signal: AbortSignal.timeout(1e3) }).then((r) => {
			if (r.ok) {
				clearInterval(interval);
				callback();
			}
		}).catch(() => {});
	}, 500);
}
function scheduleRestart() {
	if (quitting) return;
	restartAttempt++;
	const delay = Math.min(1e3 * Math.pow(2, restartAttempt - 1), MAX_RESTART_DELAY_MS);
	console.log(`[desktop/server] restarting in ${delay}ms (attempt ${restartAttempt})`);
	restartTimer = setTimeout(() => {
		restartTimer = null;
		spawnServer();
	}, delay);
}
function stopServer() {
	quitting = true;
	if (restartTimer) {
		clearTimeout(restartTimer);
		restartTimer = null;
	}
	const child = serverProcess;
	if (!child) return;
	serverProcess = null;
	child.kill("SIGTERM");
	setTimeout(() => {
		try {
			child.kill("SIGKILL");
		} catch {}
	}, SIGTERM_GRACE_MS).unref();
}
//#endregion
//#region src/menu.ts
/**
* Application menu bar for the Panopticon desktop app.
*
* Standard Electron menus: File, Edit, View, Window, Help
* Plus a Panopticon menu with all orchestration actions.
*
* macOS: app name menu with About, Settings, Services etc.
* Linux/Windows: Settings in File menu.
*/
async function fetchActiveWorkspaces() {
	if (!serverUrl) return [];
	try {
		const resp = await fetch(`${serverUrl}/api/workspaces`, { signal: AbortSignal.timeout(2e3) });
		if (!resp.ok) return [];
		return (await resp.json()).workspaces?.slice(0, 10) ?? [];
	} catch {
		return [];
	}
}
function buildMenuTemplate() {
	const template = [];
	if (process.platform === "darwin") template.push({
		label: electron.app.name,
		submenu: [
			{ role: "about" },
			{ type: "separator" },
			{
				label: "Settings...",
				accelerator: "CmdOrCtrl+,",
				click: () => {
					showOrCreateWindow();
					dispatchMenuAction("open-settings");
				}
			},
			{ type: "separator" },
			{ role: "services" },
			{ type: "separator" },
			{ role: "hide" },
			{ role: "hideOthers" },
			{ role: "unhide" },
			{ type: "separator" },
			{ role: "quit" }
		]
	});
	template.push({
		label: "File",
		submenu: [...process.platform !== "darwin" ? [{
			label: "Settings...",
			accelerator: "CmdOrCtrl+,",
			click: () => {
				showOrCreateWindow();
				dispatchMenuAction("open-settings");
			}
		}, { type: "separator" }] : [], { role: process.platform === "darwin" ? "close" : "quit" }]
	});
	template.push({ role: "editMenu" });
	template.push({
		label: "View",
		submenu: [
			{ role: "reload" },
			{ role: "forceReload" },
			{ role: "toggleDevTools" },
			{ type: "separator" },
			{ role: "resetZoom" },
			{
				role: "zoomIn",
				accelerator: "CmdOrCtrl+="
			},
			{ role: "zoomOut" },
			{ type: "separator" },
			{ role: "togglefullscreen" }
		]
	});
	template.push({ role: "windowMenu" });
	template.push({
		label: "Panopticon",
		submenu: [
			{
				label: "Start Cloister",
				click: () => callServerApi("/api/cloister/start", "POST")
			},
			{
				label: "Stop Cloister",
				click: () => callServerApi("/api/cloister/stop", "POST")
			},
			{
				label: "Emergency Stop All Agents",
				click: () => callServerApi("/api/agents/emergency-stop", "POST")
			},
			{ type: "separator" },
			{
				label: "Open Workspace",
				id: "open-workspace-submenu",
				submenu: [{
					label: "Loading...",
					enabled: false
				}]
			},
			{ type: "separator" },
			{
				label: "Settings...",
				accelerator: process.platform !== "darwin" ? "CmdOrCtrl+," : void 0,
				click: () => {
					showOrCreateWindow();
					dispatchMenuAction("open-settings");
				}
			}
		]
	});
	template.push({
		role: "help",
		submenu: [{
			label: "Panopticon on GitHub",
			click: () => void electron.shell.openExternal("https://github.com/eltmon/panopticon-cli")
		}, {
			label: "Report an Issue",
			click: () => void electron.shell.openExternal("https://github.com/eltmon/panopticon-cli/issues")
		}]
	});
	return template;
}
function configureApplicationMenu() {
	const menu = electron.Menu.buildFromTemplate(buildMenuTemplate());
	electron.Menu.setApplicationMenu(menu);
	const panopticonMenu = menu.items.find((item) => item.label === "Panopticon");
	if (panopticonMenu?.submenu) panopticonMenu.submenu.on("menu-will-show", () => {
		fetchActiveWorkspaces().then((workspaces) => {
			const wsItem = panopticonMenu.submenu?.items.find((i) => i.id === "open-workspace-submenu");
			if (wsItem) wsItem.label = workspaces.length ? `Open Workspace (${workspaces.length})` : "Open Workspace";
		});
	});
}
//#endregion
//#region src/notifications.ts
/**
* Native desktop notifications for Panopticon events.
*
* Event types and their default enabled state (all configurable in Settings):
*   inputNeeded   — Agent needs user input (default: on)
*   stuckAgents   — Agent has been stuck > threshold (default: on)
*   mergeFailures — Merge specialist failed (default: on)
*   workComplete  — Agent signalled work done (default: on)
*   planningDone  — Planning session complete (default: off)
*   mergeReady    — PR ready for human merge (default: on)
*
* Notifications are sent from:
* 1. Renderer → main via IPC (pan:notify) — for events the frontend detects
* 2. Main process directly — in future when subscribing to domain events via WS
*/
function sendNotification(eventType, title, body) {
	if (!getDesktopSettings().notifications[eventType]) return;
	if (!electron.Notification.isSupported()) return;
	const notification = new electron.Notification({
		title,
		body,
		icon: resolveResourcePath("icon.png") ?? void 0,
		silent: false
	});
	notification.on("click", () => showOrCreateWindow());
	notification.show();
}
function registerNotificationHandlers() {
	electron.ipcMain.handle(IPC.NOTIFY, (_event, eventType, title, body) => {
		if (typeof eventType === "string" && typeof title === "string" && typeof body === "string") sendNotification(eventType, title, body);
	});
}
/**
* Called at app.ready to request notification permission on macOS.
* On Linux/Windows, Notification.isSupported() handles availability.
*/
function initializeNotifications() {
	if (!electron.Notification.isSupported()) console.log("[desktop/notifications] native notifications not supported on this platform");
}
//#endregion
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
	electron.ipcMain.handle(IPC.GET_DESKTOP_SETTINGS, () => getDesktopSettings());
	electron.ipcMain.handle(IPC.UPDATE_DESKTOP_SETTING, (_event, key, value) => {
		if (typeof key !== "string") return;
		if (updateDesktopSetting(key, value) && key === "autoStart.enabled") electron.app.setLoginItemSettings({ openAtLogin: value === true });
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
function callServerApi(path, method) {
	if (!serverUrl) return;
	fetch(`${serverUrl}${path}`, { method }).catch((err) => {
		console.error("[desktop] server API call failed:", err);
	});
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
	loadDesktopSettings();
	registerIpcHandlers();
	registerNotificationHandlers();
	initializeNotifications();
	configureApplicationMenu();
	if (process.platform === "win32") electron.app.setAppUserModelId(APP_ID);
	if (process.platform === "darwin" && electron.app.dock) {
		const iconPath = resolveResourcePath("icon.png");
		if (iconPath) electron.app.dock.setIcon(iconPath);
	}
	createTray();
	startServer((port, wsUrl) => {
		serverPort = port;
		serverUrl = `http://127.0.0.1:${port}`;
		serverWsUrl = wsUrl;
		mainWindow = createWindow();
	});
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
	destroyTray();
	stopServer();
});
//#endregion
exports.DESKTOP_SCHEME = DESKTOP_SCHEME;
exports.IPC = IPC;
exports.callServerApi = callServerApi;
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