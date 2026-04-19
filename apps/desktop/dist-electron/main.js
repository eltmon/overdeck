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
let electron_updater = require("electron-updater");
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
//#region src/updater.ts
/**
* Auto-updater service using electron-updater.
*
* Handles automatic background checks for updates, downloads, and installation.
* Uses GitHub Releases as the update server.
*/
const FOUR_HOURS_MS = 14400 * 1e3;
let checkIntervalId = null;
let initialized = false;
let currentStatus = {
	checking: false,
	available: false,
	downloaded: false,
	version: null,
	error: null
};
let statusCallbacks = [];
/**
* Register a callback to receive update status changes.
*/
function onUpdateStatusChange(callback) {
	statusCallbacks.push(callback);
}
/**
* Notify all listeners of status change
*/
function notifyStatusChange() {
	for (const cb of statusCallbacks) cb(currentStatus);
}
/**
* Send update event to all browser windows
*/
function broadcastToRenderers(channel, ...args) {
	for (const win of electron.BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, ...args);
}
/**
* Initialize the auto-updater service.
* Sets up event handlers and starts periodic update checks.
*/
function initializeAutoUpdater(channel = "latest") {
	if (initialized) {
		console.log("[updater] Already initialized, skipping...");
		return;
	}
	initialized = true;
	electron_updater.autoUpdater.setFeedURL({
		provider: "github",
		owner: "eltmon",
		repo: "panopticon-cli"
	});
	electron_updater.autoUpdater.channel = channel;
	electron_updater.autoUpdater.autoDownload = false;
	electron_updater.autoUpdater.autoInstallOnAppQuit = true;
	electron_updater.autoUpdater.on("checking-for-update", () => {
		currentStatus = {
			...currentStatus,
			checking: true,
			error: null
		};
		notifyStatusChange();
		broadcastToRenderers("update-status", currentStatus);
		console.log("[updater] Checking for update...");
	});
	electron_updater.autoUpdater.on("update-available", (info) => {
		currentStatus = {
			checking: false,
			available: true,
			downloaded: false,
			version: info.version,
			error: null
		};
		notifyStatusChange();
		broadcastToRenderers("update-status", currentStatus);
		console.log(`[updater] Update available: ${info.version}`);
	});
	electron_updater.autoUpdater.on("update-not-available", (info) => {
		currentStatus = {
			checking: false,
			available: false,
			downloaded: false,
			version: info.version,
			error: null
		};
		notifyStatusChange();
		broadcastToRenderers("update-status", currentStatus);
		console.log(`[updater] Update not available. Current version: ${info.version}`);
	});
	electron_updater.autoUpdater.on("download-progress", (progressObj) => {
		const percent = progressObj.percent.toFixed(1);
		currentStatus = {
			...currentStatus,
			checking: false
		};
		notifyStatusChange();
		broadcastToRenderers("update-download-progress", {
			percent,
			transferred: progressObj.transferred,
			total: progressObj.total
		});
		console.log(`[updater] Download progress: ${percent}%`);
	});
	electron_updater.autoUpdater.on("update-downloaded", (info) => {
		currentStatus = {
			checking: false,
			available: true,
			downloaded: true,
			version: info.version,
			error: null
		};
		notifyStatusChange();
		broadcastToRenderers("update-status", currentStatus);
		broadcastToRenderers("update-downloaded", { version: info.version });
		console.log(`[updater] Update downloaded: ${info.version}`);
	});
	electron_updater.autoUpdater.on("error", (err) => {
		currentStatus = {
			checking: false,
			available: false,
			downloaded: false,
			version: null,
			error: err.message
		};
		notifyStatusChange();
		broadcastToRenderers("update-status", currentStatus);
		console.error("[updater] Error:", err.message);
	});
	setTimeout(() => {
		checkForUpdates();
	}, 3e3);
	startPeriodicChecks();
}
/**
* Start periodic update checks every 4 hours.
*/
function startPeriodicChecks() {
	if (checkIntervalId !== null) return;
	checkIntervalId = setInterval(() => {
		checkForUpdates();
	}, FOUR_HOURS_MS);
	console.log("[updater] Started periodic update checks (every 4 hours)");
}
/**
* Check for updates manually.
* Returns a promise that resolves when the check completes.
*/
async function checkForUpdates() {
	if (currentStatus.checking) {
		console.log("[updater] Already checking for update, skipping...");
		return;
	}
	try {
		console.log("[updater] Starting update check...");
		await electron_updater.autoUpdater.checkForUpdates();
	} catch (err) {
		console.error("[updater] Check for updates failed:", err);
	}
}
/**
* Download the available update.
*/
async function downloadUpdate() {
	if (!currentStatus.available) {
		console.log("[updater] No update available to download");
		return;
	}
	try {
		console.log("[updater] Starting update download...");
		await electron_updater.autoUpdater.downloadUpdate();
	} catch (err) {
		console.error("[updater] Download update failed:", err);
	}
}
/**
* Quit and install the downloaded update.
*/
function quitAndInstall() {
	if (!currentStatus.downloaded) {
		console.log("[updater] No update downloaded to install");
		return;
	}
	console.log("[updater] Quitting and installing update...");
	electron_updater.autoUpdater.quitAndInstall();
}
/**
* Get current update status.
*/
function getUpdateStatus() {
	return currentStatus;
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
let updateDownloaded = false;
function rebuildMenu() {
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
		submenu: [
			{
				label: "Check for Updates...",
				click: () => {
					checkForUpdates();
				}
			},
			{ type: "separator" },
			{
				label: "Panopticon on GitHub",
				click: () => void electron.shell.openExternal("https://github.com/eltmon/panopticon-cli")
			},
			{
				label: "Report an Issue",
				click: () => void electron.shell.openExternal("https://github.com/eltmon/panopticon-cli/issues")
			}
		]
	});
	if (updateDownloaded) {
		const helpMenu = template[template.length - 1];
		if (helpMenu && helpMenu.submenu && Array.isArray(helpMenu.submenu)) helpMenu.submenu.push({ type: "separator" }, {
			label: "Install Update and Restart",
			click: () => {
				quitAndInstall();
			}
		});
	}
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
	onUpdateStatusChange((status) => {
		if (status.downloaded && !updateDownloaded) {
			updateDownloaded = true;
			rebuildMenu();
		}
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
//#region src/autostart.ts
/**
* Auto-start nag flow for the Panopticon desktop app.
*
* Flow:
*   Launch 1:   Full explanation dialog (warm, inviting)
*   Launch 2-5: In-app toasts dispatched to renderer via "auto-start-nag:<n>:<max>" menu action
*               - Shows: "Reminder N of 5", Enable button (prominent), Not Yet, Stop Reminding Me
*   After 5 or "Stop reminding me": never prompt again (nagDismissed = true)
*   Once enabled: auto-start registered via app.setLoginItemSettings
*
* State tracked in DesktopSettings.autoStart via settings.ts.
*/
const NAG_MAX = 5;
function enableAutoStart() {
	updateDesktopSetting("autoStart.enabled", true);
	updateDesktopSetting("autoStart.nagDismissed", true);
	electron.app.setLoginItemSettings({ openAtLogin: true });
}
function handleAutoStartNag() {
	const { autoStart } = getDesktopSettings();
	if (autoStart.enabled || autoStart.nagDismissed) return;
	if (autoStart.nagCount >= NAG_MAX) {
		updateDesktopSetting("autoStart.nagDismissed", true);
		return;
	}
	const count = autoStart.nagCount + 1;
	updateDesktopSetting("autoStart.nagCount", count);
	if (count === 1) showFirstLaunchDialog();
	else setTimeout(() => {
		dispatchMenuAction(`auto-start-nag:${count}:${NAG_MAX}`);
	}, 3500);
}
function showFirstLaunchDialog() {
	setTimeout(() => {
		electron.dialog.showMessageBox({
			type: "info",
			title: "Start Panopticon automatically?",
			message: "Keep an eye on your agents — even when you forget to open the app.",
			detail: "Panopticon can start automatically when you log in, so you never miss an agent asking for help or a merge that's ready to ship.\n\nYou can change this at any time in Settings → Desktop → Auto-start.",
			buttons: ["Enable Auto-start", "Not Yet"],
			defaultId: 0,
			cancelId: 1
		}).then(({ response }) => {
			if (response === 0) enableAutoStart();
		});
	}, 2e3);
}
//#endregion
//#region src/protocol.ts
/**
* panopticon:// custom protocol for serving static frontend assets in packaged builds.
*
* In dev mode:
*   BrowserWindow loads from Vite dev server URL (VITE_DEV_SERVER_URL env var).
*   HMR and source maps work normally.
*
* In packaged builds:
*   BrowserWindow loads panopticon://app/index.html.
*   This protocol handler serves files from the bundled dist/dashboard/public/.
*   WebSocket connections (ws/rpc, ws/terminal) go to the embedded server port
*   on localhost — the protocol handler only serves static assets.
*
* Security:
*   - Path traversal protection: rejects paths containing ".."
*   - Only files within the static root are served
*   - Non-existent asset requests return -6 (net::ERR_FILE_NOT_FOUND)
*   - HTML routes (no extension) fall back to index.html for SPA routing
*
* CSP:
*   Renderer CSP is configured via vite.config.ts in the frontend.
*   In packaged mode, connect-src must include ws://127.0.0.1:* for WebSocket.
*/
let registered = false;
function resolveStaticPath(staticRoot, requestUrl) {
	const fallbackIndex = node_path.join(staticRoot, "index.html");
	let url;
	try {
		url = new URL(requestUrl);
	} catch {
		return fallbackIndex;
	}
	const rawPath = decodeURIComponent(url.pathname);
	const normalized = node_path.posix.normalize(rawPath).replace(/^\/+/, "");
	if (normalized.includes("..")) return fallbackIndex;
	const requestedPath = normalized.length > 0 ? normalized : "index.html";
	const resolved = node_path.resolve(staticRoot, requestedPath);
	const staticRootResolved = node_path.resolve(staticRoot);
	if (!(resolved === staticRootResolved || resolved.startsWith(staticRootResolved + node_path.sep))) return fallbackIndex;
	if (node_path.extname(resolved)) return resolved;
	const nestedIndex = node_path.join(resolved, "index.html");
	if (node_fs.existsSync(nestedIndex)) return nestedIndex;
	return fallbackIndex;
}
/**
* Register the panopticon:// protocol handler.
* Must be called after app.ready (but registration via registerSchemesAsPrivileged
* must happen before app.ready — done in main.ts).
*/
function registerDesktopProtocol() {
	if (registered) return;
	const staticRoot = resolveServerStaticDir();
	if (!staticRoot) {
		console.error("[desktop/protocol] Static bundle not found — packaged frontend assets missing. Run 'npm run build:dashboard' first.");
		return;
	}
	const fallbackIndex = node_path.join(staticRoot, "index.html");
	electron.protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
		const candidate = resolveStaticPath(staticRoot, request.url);
		const hasExt = node_path.extname(candidate).length > 0;
		if (!node_fs.existsSync(candidate)) {
			if (hasExt) callback({ error: -6 });
			else callback({ path: fallbackIndex });
			return;
		}
		callback({ path: candidate });
	});
	registered = true;
	console.log(`[desktop/protocol] registered ${DESKTOP_SCHEME}:// serving from ${staticRoot}`);
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
	OPEN_TERMINAL_WINDOW: "pan:open-terminal-window",
	SET_ALWAYS_ON_TOP: "pan:set-always-on-top",
	MENU_ACTION: "pan:menu-action",
	GET_DESKTOP_SETTINGS: "pan:get-desktop-settings",
	UPDATE_DESKTOP_SETTING: "pan:update-desktop-setting",
	NOTIFY: "pan:notify",
	GET_UPDATE_STATUS: "pan:get-update-status",
	CHECK_FOR_UPDATES: "pan:check-for-updates",
	DOWNLOAD_UPDATE: "pan:download-update",
	QUIT_AND_INSTALL: "pan:quit-and-install"
};
let mainWindow = null;
let serverPort = 0;
let serverUrl = "";
let serverWsUrl = "";
let isQuitting = false;
const terminalWindows = /* @__PURE__ */ new Map();
function resolveResourcePath(fileName) {
	const candidates = [
		node_path.join(process.resourcesPath ?? "", "resources", fileName),
		node_path.join(__dirname, "../resources", fileName),
		node_path.join(ROOT_DIR, "apps/desktop/resources", fileName)
	];
	for (const candidate of candidates) if (node_fs.existsSync(candidate)) return candidate;
	return null;
}
function resolveServerEntry() {
	if (electron.app.isPackaged) return node_path.join(process.resourcesPath ?? "", "server/server.js");
	const npxBundle = node_path.join(__dirname, "../server/server.js");
	if (node_fs.existsSync(npxBundle)) return npxBundle;
	return node_path.join(ROOT_DIR, "dist/dashboard/server.js");
}
function resolveServerStaticDir() {
	const candidates = [];
	if (electron.app.isPackaged) candidates.push(node_path.join(process.resourcesPath ?? "", "server/public"));
	else {
		candidates.push(node_path.join(__dirname, "../server/public"));
		candidates.push(node_path.join(ROOT_DIR, "dist/dashboard/public"));
	}
	for (const candidate of candidates) if (node_fs.existsSync(node_path.join(candidate, "index.html"))) return candidate;
	return null;
}
function resolveWindowUrl() {
	if (isDevelopment) return process.env.VITE_DEV_SERVER_URL;
	return `${DESKTOP_SCHEME}://app/index.html`;
}
function createTerminalWindow(sessionName, title) {
	const win = new electron.BrowserWindow({
		width: 900,
		height: 650,
		title,
		webPreferences: {
			preload: node_path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false
		},
		show: false
	});
	win.once("ready-to-show", () => win.show());
	win.loadURL(`${resolveWindowUrl()}?terminal=${encodeURIComponent(sessionName)}&title=${encodeURIComponent(title)}`);
	return win;
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
	electron.ipcMain.on(IPC.OPEN_TERMINAL_WINDOW, (_event, sessionName, title) => {
		if (typeof sessionName !== "string" || typeof title !== "string") return;
		const existing = terminalWindows.get(sessionName);
		if (existing && !existing.isDestroyed()) {
			if (!existing.isVisible()) existing.show();
			existing.focus();
			return;
		}
		const win = createTerminalWindow(sessionName, title);
		terminalWindows.set(sessionName, win);
		win.on("closed", () => terminalWindows.delete(sessionName));
	});
	electron.ipcMain.on(IPC.SET_ALWAYS_ON_TOP, (_event, value) => {
		const focused = electron.BrowserWindow.getFocusedWindow();
		if (focused) focused.setAlwaysOnTop(value === true);
	});
	electron.ipcMain.handle(IPC.UPDATE_DESKTOP_SETTING, (_event, key, value) => {
		if (typeof key !== "string") return;
		if (updateDesktopSetting(key, value) && key === "autoStart.enabled") electron.app.setLoginItemSettings({ openAtLogin: value === true });
	});
	electron.ipcMain.handle(IPC.GET_UPDATE_STATUS, () => getUpdateStatus());
	electron.ipcMain.handle(IPC.CHECK_FOR_UPDATES, async () => {
		try {
			await checkForUpdates();
		} catch (err) {
			console.error("[main] checkForUpdates failed:", err);
		}
		return getUpdateStatus();
	});
	electron.ipcMain.handle(IPC.DOWNLOAD_UPDATE, async () => {
		try {
			await downloadUpdate();
		} catch (err) {
			console.error("[main] downloadUpdate failed:", err);
		}
		return getUpdateStatus();
	});
	electron.ipcMain.on(IPC.QUIT_AND_INSTALL, () => {
		quitAndInstall();
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
	registerDesktopProtocol();
	initializeAutoUpdater(electron.app.getVersion().includes("-canary") ? "beta" : "latest");
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
		handleAutoStartNag();
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