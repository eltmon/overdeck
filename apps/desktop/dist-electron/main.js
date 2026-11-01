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
let node_os = require("node:os");
node_os = __toESM(node_os);
let node_dns = require("node:dns");
let node_net = require("node:net");
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
//#region src/connection.ts
/**
* The dashboard the desktop app currently shows: the embedded local server or
* the one chosen machine (PAN-4402 W-4).
*
* This is the one piece of runtime state main, menu and tray share. In remote
* mode main-process calls carry the device token as a bearer (D-10), and the
* remote windows authenticate with the device cookie set in an in-memory
* partition, so the cookie never reaches disk (D-3).
*/
/** baseUrl is '' until the embedded server is ready. */
let active = {
	kind: "local",
	baseUrl: ""
};
function getActiveDashboard() {
	return active;
}
function setLocalDashboard(baseUrl) {
	active = {
		kind: "local",
		baseUrl
	};
}
/** No `persist:` prefix, so the partition's cookies and storage stay in memory. */
function remotePartitionName(environmentId) {
	return `remote-${environmentId}`;
}
function setRemoteDashboard(record, token) {
	active = {
		kind: "remote",
		baseUrl: record.baseUrl,
		partition: remotePartitionName(record.environmentId),
		label: record.label,
		token
	};
}
function dashboardFetch(path, init = {}) {
	const current = active;
	if (!current.baseUrl) return Promise.reject(/* @__PURE__ */ new Error("The dashboard server is not ready yet."));
	if (current.kind === "local") return fetch(`${current.baseUrl}${path}`, init);
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${current.token}`);
	return fetch(`${current.baseUrl}${path}`, {
		...init,
		headers
	});
}
async function prepareRemoteSession(remote) {
	if (remote.partition.startsWith("persist:")) throw new Error(`Refusing to store a machine credential in the persistent partition ${remote.partition}.`);
	const ses = electron.session.fromPartition(remote.partition);
	await ses.cookies.set({
		url: remote.baseUrl,
		name: "overdeck_device",
		value: remote.token,
		httpOnly: true,
		sameSite: "strict",
		secure: remote.baseUrl.startsWith("https:")
	});
	return ses;
}
function isSameOrigin(url, baseUrl) {
	try {
		return new URL(url).origin === new URL(baseUrl).origin;
	} catch {
		return false;
	}
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
	const settings = getDesktopSettings();
	const active = getActiveDashboard();
	const title = active.kind === "remote" ? `Overdeck — ${active.label}` : "Overdeck";
	if (settings.tray.tooltipDetail === "minimal") return `${title} — ${agentCount} agent${agentCount !== 1 ? "s" : ""}`;
	const lines = [title];
	lines.push(`${agentCount} agent${agentCount !== 1 ? "s" : ""} running`);
	if (attentionCount > 0) lines.push(`⚠ ${attentionCount} need${attentionCount !== 1 ? "" : "s"} attention`);
	if (lastActivity) lines.push(`Last: ${lastActivity}`);
	return lines.join("\n");
}
function buildContextMenu() {
	const template = [
		{
			label: "Show Dashboard",
			click: () => showOrCreateWindow()
		},
		{
			label: "Connect to a Machine…",
			click: () => openConnectWindowFromMenu()
		},
		{
			label: "Use This Computer",
			enabled: getActiveDashboard().kind === "remote",
			click: () => useThisComputer()
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
	];
	return electron.Menu.buildFromTemplate(template);
}
async function refreshTrayStatus() {
	if (!tray || isQuitting) return;
	if (!getActiveDashboard().baseUrl) return;
	try {
		const resp = await dashboardFetch("/api/health", { signal: AbortSignal.timeout(3e3) });
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
	tray.setToolTip("Overdeck");
	tray.setContextMenu(buildContextMenu());
	tray.on("click", () => showOrCreateWindow());
	pollTimer = setInterval(() => void refreshTrayStatus(), 5e3);
	refreshTrayStatus();
}
/** Rebuild the context menu and tooltip after a switch between this computer and the chosen machine. */
function refreshTrayMode() {
	if (!tray) return;
	const active = getActiveDashboard();
	tray.setToolTip(active.kind === "remote" ? `Overdeck — ${active.label}` : "Overdeck");
	tray.setContextMenu(buildContextMenu());
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
*   OVERDECK_PORT        — TCP port for HTTP + WS
*   OVERDECK_AUTH_TOKEN  — random hex token (future: auth middleware)
*   OVERDECK_MODE        — "desktop" (enables desktop-specific behaviours)
*   OVERDECK_NO_BROWSER  — "1" (suppresses auto browser open)
*/
const BASE_PORT = 7825;
const MAX_RESTART_DELAY_MS = 3e4;
const MAX_RESTART_ATTEMPTS = 8;
const SIGTERM_GRACE_MS = 3e3;
let serverProcess = null;
let restartAttempt = 0;
let restartTimer = null;
let waitInterval = null;
let quitting = false;
let onReadyCallback = null;
function randomHex(bytes) {
	return node_crypto.randomBytes(bytes).toString("hex");
}
function resolvePort() {
	return BASE_PORT + restartAttempt % 10;
}
function startServer(onReady) {
	quitting = false;
	restartAttempt = 0;
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
			API_PORT: String(port),
			OVERDECK_PORT: String(port),
			OVERDECK_FRONTEND_DIR: resolveServerStaticDir() ?? void 0,
			OVERDECK_AUTH_TOKEN: authToken,
			OVERDECK_MODE: "desktop",
			OVERDECK_NO_BROWSER: "1",
			TERM: process.env.TERM || "xterm-256color",
			COLORTERM: process.env.COLORTERM || "truecolor",
			LANG: process.env.LANG || "en_US.UTF-8",
			ELECTRON_RUN_AS_NODE: "1"
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
		waitForServer(`http://127.0.0.1:${port}`, (healthy) => {
			console.log(`[desktop/server] ready on port ${port} (healthy=${String(healthy)})`);
			if (healthy) restartAttempt = 0;
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
	if (waitInterval) clearInterval(waitInterval);
	const start = Date.now();
	const interval = setInterval(() => {
		if (Date.now() - start > maxMs) {
			clearInterval(interval);
			if (waitInterval === interval) waitInterval = null;
			callback(false);
			return;
		}
		fetch(url + "/api/health", { signal: AbortSignal.timeout(1e3) }).then((r) => {
			if (r.ok) {
				clearInterval(interval);
				if (waitInterval === interval) waitInterval = null;
				callback(true);
			}
		}).catch(() => {});
	}, 500);
	waitInterval = interval;
}
function scheduleRestart() {
	if (quitting) return;
	restartAttempt++;
	if (restartAttempt > MAX_RESTART_ATTEMPTS) {
		console.error(`[desktop/server] server failed ${MAX_RESTART_ATTEMPTS} consecutive times — giving up. Use the app menu's dashboard restart to retry.`);
		return;
	}
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
	if (waitInterval) {
		clearInterval(waitInterval);
		waitInterval = null;
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
/** Native desktop updater backed by electron-updater and exact GitHub releases. */
const OVERDECK_DASHBOARD_PROTOCOL_VERSION = 1;
const OVERDECK_AGENT_PROTOCOL_VERSION = 1;
const FOUR_HOURS_MS = 14400 * 1e3;
const DOWNLOAD_RETRY_MS = [
	0,
	1e3,
	4e3
];
const RELEASES_URL = "https://api.github.com/repos/eltmon/overdeck/releases";
let checkIntervalId = null;
let initialized = false;
let channel = "stable";
let currentStatus = {
	phase: "idle",
	installMode: "desktop",
	channel: "stable",
	currentVersion: electron.app.getVersion(),
	targetVersion: null,
	releaseName: null,
	releaseNotes: null,
	releaseUrl: null,
	publishedAt: null,
	progressPercent: null,
	error: null,
	lastCheckedAt: null,
	compatibility: "unknown",
	currentDashboardProtocol: OVERDECK_DASHBOARD_PROTOCOL_VERSION,
	currentAgentProtocol: OVERDECK_AGENT_PROTOCOL_VERSION,
	targetDashboardProtocol: null,
	targetAgentProtocol: null
};
const statusCallbacks = [];
function onUpdateStatusChange(callback) {
	statusCallbacks.push(callback);
	return () => {
		const index = statusCallbacks.indexOf(callback);
		if (index >= 0) statusCallbacks.splice(index, 1);
	};
}
function publish(patch) {
	currentStatus = {
		...currentStatus,
		...patch
	};
	for (const callback of statusCallbacks) callback(currentStatus);
	for (const win of electron.BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send("update-status", currentStatus);
}
function manifestName() {
	const prefix = channel === "canary" ? "beta" : "latest";
	if (process.platform === "darwin") return `${prefix}-mac.yml`;
	if (process.platform === "linux") return `${prefix}-linux.yml`;
	return `${prefix}.yml`;
}
async function configureExactReleaseFeed() {
	const response = await fetch(RELEASES_URL, {
		headers: { accept: "application/vnd.github+json" },
		signal: AbortSignal.timeout(1e4)
	});
	if (!response.ok) throw new Error(`GitHub Releases returned ${response.status}`);
	const release = (await response.json()).find((item) => channel === "canary" ? item.prerelease : !item.prerelease);
	if (!release) throw new Error(`No ${channel} desktop release is published`);
	const manifest = release.assets?.find((asset) => asset.name === manifestName());
	if (!manifest) throw new Error(`${release.tag_name} is missing ${manifestName()}`);
	const manifestResponse = await fetch(manifest.browser_download_url, { signal: AbortSignal.timeout(1e4) });
	if (!manifestResponse.ok) throw new Error(`Update manifest returned ${manifestResponse.status}`);
	const manifestText = await manifestResponse.text();
	const dashboardProtocol = Number(manifestText.match(/^overdeckDashboardProtocol:\s*(\d+)/m)?.[1]) || null;
	const agentProtocol = Number(manifestText.match(/^overdeckAgentProtocol:\s*(\d+)/m)?.[1]) || null;
	publish({
		releaseName: release.name ?? `Overdeck ${release.tag_name}`,
		releaseNotes: release.body ?? "Release notes are not available for this release.",
		releaseUrl: release.html_url ?? null,
		publishedAt: release.published_at ?? null,
		targetDashboardProtocol: dashboardProtocol,
		targetAgentProtocol: agentProtocol,
		compatibility: dashboardProtocol === OVERDECK_DASHBOARD_PROTOCOL_VERSION && agentProtocol === OVERDECK_AGENT_PROTOCOL_VERSION ? "compatible" : "unknown"
	});
	electron_updater.autoUpdater.setFeedURL({
		provider: "generic",
		url: `https://github.com/eltmon/overdeck/releases/download/${release.tag_name}`
	});
	electron_updater.autoUpdater.channel = channel === "canary" ? "beta" : "latest";
}
function initializeAutoUpdater(requestedChannel = "latest") {
	if (initialized) return;
	initialized = true;
	channel = requestedChannel === "canary" || requestedChannel === "beta" ? "canary" : "stable";
	publish({ channel });
	electron_updater.autoUpdater.autoDownload = false;
	electron_updater.autoUpdater.autoInstallOnAppQuit = false;
	electron_updater.autoUpdater.on("checking-for-update", () => publish({
		phase: "checking",
		error: null
	}));
	electron_updater.autoUpdater.on("update-available", (info) => publish({
		phase: "available",
		targetVersion: info.version,
		progressPercent: null,
		error: null,
		lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString()
	}));
	electron_updater.autoUpdater.on("update-not-available", (info) => publish({
		phase: "current",
		targetVersion: info.version,
		progressPercent: null,
		error: null,
		lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString()
	}));
	electron_updater.autoUpdater.on("download-progress", (progress) => publish({
		phase: "downloading",
		progressPercent: Math.round(progress.percent * 10) / 10
	}));
	electron_updater.autoUpdater.on("update-downloaded", (info) => publish({
		phase: "ready",
		targetVersion: info.version,
		progressPercent: 100,
		error: null
	}));
	electron_updater.autoUpdater.on("error", (error) => publish({
		phase: "error",
		error: error.message
	}));
	setTimeout(() => {
		checkForUpdates();
	}, 5e3);
	startPeriodicChecks();
}
function startPeriodicChecks() {
	checkIntervalId ??= setInterval(() => {
		checkForUpdates();
	}, FOUR_HOURS_MS);
}
async function checkForUpdates() {
	if (currentStatus.phase === "checking") return getUpdateStatus();
	publish({
		phase: "checking",
		error: null
	});
	try {
		await configureExactReleaseFeed();
		await electron_updater.autoUpdater.checkForUpdates();
	} catch (error) {
		publish({
			phase: "error",
			error: error instanceof Error ? error.message : String(error),
			lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	return getUpdateStatus();
}
async function downloadUpdate() {
	if (currentStatus.phase !== "available") return getUpdateStatus();
	for (let attempt = 0; attempt < DOWNLOAD_RETRY_MS.length; attempt += 1) {
		const delay = DOWNLOAD_RETRY_MS[attempt] ?? 0;
		if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
		try {
			publish({
				phase: "downloading",
				error: null,
				progressPercent: 0
			});
			await electron_updater.autoUpdater.downloadUpdate();
			return getUpdateStatus();
		} catch (error) {
			if (attempt === DOWNLOAD_RETRY_MS.length - 1) publish({
				phase: "error",
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return getUpdateStatus();
}
function quitAndInstall() {
	if (currentStatus.phase === "ready") electron_updater.autoUpdater.quitAndInstall(false, true);
}
function getUpdateStatus() {
	return { ...currentStatus };
}
//#endregion
//#region src/menu.ts
/**
* Application menu bar for the Overdeck desktop app.
*
* Standard Electron menus: File, Edit, View, Window, Help
* Plus a Overdeck menu with all orchestration actions.
*
* macOS: app name menu with About, Settings, Services etc.
* Linux/Windows: Settings in File menu.
*/
async function fetchActiveWorkspaces() {
	try {
		const resp = await dashboardFetch("/api/workspaces", { signal: AbortSignal.timeout(2e3) });
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
	const overdeckMenu = menu.items.find((item) => item.label === "Overdeck");
	if (overdeckMenu?.submenu) overdeckMenu.submenu.on("menu-will-show", () => {
		fetchActiveWorkspaces().then((workspaces) => {
			const wsItem = overdeckMenu.submenu?.items.find((i) => i.id === "open-workspace-submenu");
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
	const active = getActiveDashboard();
	template.push({
		label: "Overdeck",
		submenu: [
			...active.kind === "remote" ? [{
				label: `Showing ${active.label}`,
				enabled: false
			}, { type: "separator" }] : [],
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
				label: "Connect to a Machine…",
				click: () => openConnectWindowFromMenu()
			},
			{
				label: "Use This Computer",
				enabled: active.kind === "remote",
				click: () => useThisComputer()
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
					showOrCreateWindow();
					dispatchMenuAction("open-updater");
				}
			},
			{ type: "separator" },
			{
				label: "Flywheel Documentation",
				click: () => void electron.shell.openExternal("https://github.com/eltmon/overdeck/blob/main/docs/FLYWHEEL.md")
			},
			{
				label: "Overdeck on GitHub",
				click: () => void electron.shell.openExternal("https://github.com/eltmon/overdeck")
			},
			{
				label: "Report an Issue",
				click: () => void electron.shell.openExternal("https://github.com/eltmon/overdeck/issues")
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
/** Rebuild after a switch between this computer and the chosen machine. */
function refreshApplicationMenu() {
	rebuildMenu();
}
function configureApplicationMenu() {
	const menu = electron.Menu.buildFromTemplate(buildMenuTemplate());
	electron.Menu.setApplicationMenu(menu);
	const overdeckMenu = menu.items.find((item) => item.label === "Overdeck");
	if (overdeckMenu?.submenu) overdeckMenu.submenu.on("menu-will-show", () => {
		fetchActiveWorkspaces().then((workspaces) => {
			const wsItem = overdeckMenu.submenu?.items.find((i) => i.id === "open-workspace-submenu");
			if (wsItem) wsItem.label = workspaces.length ? `Open Workspace (${workspaces.length})` : "Open Workspace";
		});
	});
	onUpdateStatusChange((status) => {
		if (status.phase === "ready" && !updateDownloaded) {
			updateDownloaded = true;
			rebuildMenu();
		}
	});
}
//#endregion
//#region src/notifications.ts
/**
* Native desktop notifications for Overdeck events.
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
* Auto-start nag flow for the Overdeck desktop app.
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
			title: "Start Overdeck automatically?",
			message: "Keep an eye on your agents — even when you forget to open the app.",
			detail: "Overdeck can start automatically when you log in, so you never miss an agent asking for help or a merge that's ready to ship.\n\nYou can change this at any time in Settings → Desktop → Auto-start.",
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
* overdeck:// custom protocol for serving static frontend assets in packaged builds.
*
* In dev mode:
*   BrowserWindow loads from Vite dev server URL (VITE_DEV_SERVER_URL env var).
*   HMR and source maps work normally.
*
* In packaged builds:
*   BrowserWindow loads overdeck://app/index.html.
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
* Register the overdeck:// protocol handler.
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
//#region src/boot.ts
/** Local when there is no record, the record is inactive, or the Vite dev server is in use. */
function planBoot(record, isDevelopment) {
	if (!record || !record.active || isDevelopment) return { kind: "local" };
	return {
		kind: "remote",
		record
	};
}
//#endregion
//#region src/machine-store.ts
/**
* The chosen machine's record, persisted to userData/remote-machine.json.
*
* Holds at most one machine (PAN-4402 D-1). The device token is stored only as
* safeStorage ciphertext; the plaintext never reaches disk, a renderer or a log.
* Saving refuses when the OS has no real secret store (D-4).
*/
const NO_SECRET_STORE_ERROR = "This computer has no secure credential store (GNOME Keyring, KWallet, Keychain or Windows credential protection), so Overdeck will not save a machine credential.";
function recordPath() {
	return node_path.join(electron.app.getPath("userData"), "remote-machine.json");
}
function writeRecord(record) {
	const final = recordPath();
	const tmp = `${final}.tmp`;
	node_fs.mkdirSync(node_path.dirname(final), { recursive: true });
	node_fs.rmSync(tmp, { force: true });
	node_fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 384 });
	node_fs.renameSync(tmp, final);
}
function isMachineRecord(value) {
	if (typeof value !== "object" || value === null) return false;
	const r = value;
	return r.version === 1 && typeof r.active === "boolean" && typeof r.baseUrl === "string" && typeof r.environmentId === "string" && typeof r.label === "string" && typeof r.deviceId === "string" && typeof r.pairedAt === "string" && typeof r.tokenCiphertext === "string";
}
function credentialStoreStatus() {
	if (!electron.safeStorage.isEncryptionAvailable()) return {
		ok: false,
		error: NO_SECRET_STORE_ERROR
	};
	if (process.platform === "linux") {
		const backend = electron.safeStorage.getSelectedStorageBackend();
		if (backend === "basic_text" || backend === "unknown") return {
			ok: false,
			error: NO_SECRET_STORE_ERROR
		};
	}
	return { ok: true };
}
function loadMachineRecord() {
	let raw;
	try {
		raw = node_fs.readFileSync(recordPath(), "utf8");
	} catch {
		return null;
	}
	try {
		const parsed = JSON.parse(raw);
		if (isMachineRecord(parsed)) return parsed;
	} catch {}
	console.error("[desktop] ignoring malformed remote-machine.json");
	return null;
}
function saveMachineRecord(input, token) {
	const status = credentialStoreStatus();
	if (!status.ok) throw new Error(status.error);
	const tokenCiphertext = electron.safeStorage.encryptString(token).toString("base64");
	writeRecord({
		version: 1,
		active: input.active,
		baseUrl: input.baseUrl,
		environmentId: input.environmentId,
		label: input.label,
		deviceId: input.deviceId,
		pairedAt: input.pairedAt,
		tokenCiphertext
	});
}
function setMachineActive(active) {
	const record = loadMachineRecord();
	if (!record || record.active === active) return;
	writeRecord({
		...record,
		active
	});
}
function readMachineToken(record) {
	return electron.safeStorage.decryptString(Buffer.from(record.tokenCiphertext, "base64"));
}
function deleteMachineRecord() {
	node_fs.rmSync(recordPath(), { force: true });
}
//#endregion
//#region src/machine-url.ts
/**
* Pairing-link parsing and the transport policy for a chosen machine.
*
* Pure: no Electron import. The DNS lookup is injected so the policy can be
* tested without network; production passes `dns.promises.lookup(host, { all: true })`.
*
* Transport policy (PAN-4402 D-5): the device token travels only over HTTPS,
* this computer's loopback, or a Tailscale address (WireGuard encrypts the tailnet).
*/
const BARE_CREDENTIAL_ERROR = "Paste the whole pairing link, including the address.";
const NOT_A_LINK_ERROR = "That is not an Overdeck pairing link.";
const TRANSPORT_REFUSED_ERROR = "Overdeck sends this computer's credential only over HTTPS, Tailscale or this computer's loopback. Use the machine's Tailscale address or an HTTPS address.";
const tailnet = new node_net.BlockList();
tailnet.addSubnet("100.64.0.0", 10, "ipv4");
tailnet.addSubnet("fd7a:115c:a1e0::", 48, "ipv6");
const loopback = new node_net.BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");
function inList(list, ip) {
	const family = (0, node_net.isIP)(ip);
	if (family === 4) return list.check(ip, "ipv4");
	if (family === 6) return list.check(ip, "ipv6");
	return false;
}
/** True for 100.64.0.0/10 and fd7a:115c:a1e0::/48. */
function isTailnetAddress(ip) {
	return inList(tailnet, ip);
}
/** True for 127.0.0.0/8 and ::1. */
function isLoopbackAddress(ip) {
	return inList(loopback, ip);
}
function parsePairingLink(input) {
	const text = input.trim();
	if (text.startsWith("odp_")) return {
		ok: false,
		error: BARE_CREDENTIAL_ERROR
	};
	let url;
	try {
		url = new URL(text);
	} catch {
		return {
			ok: false,
			error: NOT_A_LINK_ERROR
		};
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return {
		ok: false,
		error: NOT_A_LINK_ERROR
	};
	const credential = new URLSearchParams(url.hash.slice(1)).get("pair");
	if (!credential || !credential.startsWith("odp_")) return {
		ok: false,
		error: NOT_A_LINK_ERROR
	};
	return {
		ok: true,
		link: {
			baseUrl: url.origin,
			credential
		}
	};
}
async function assessMachineTransport(baseUrl, lookupAll) {
	const refused = {
		ok: false,
		error: TRANSPORT_REFUSED_ERROR
	};
	let url;
	try {
		url = new URL(baseUrl);
	} catch {
		return refused;
	}
	if (url.protocol === "https:") return {
		ok: true,
		kind: "https"
	};
	if (url.protocol !== "http:") return refused;
	const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
	if (host === "localhost" || isLoopbackAddress(host)) return {
		ok: true,
		kind: "loopback"
	};
	if (isTailnetAddress(host) || host.endsWith(".ts.net")) return {
		ok: true,
		kind: "tailnet"
	};
	if ((0, node_net.isIP)(host) !== 0) return refused;
	let addresses;
	try {
		addresses = await lookupAll(host);
	} catch {
		return refused;
	}
	if (addresses.length === 0) return refused;
	if (addresses.every(isTailnetAddress)) return {
		ok: true,
		kind: "tailnet"
	};
	if (addresses.every(isLoopbackAddress)) return {
		ok: true,
		kind: "loopback"
	};
	return refused;
}
const REQUEST_TIMEOUT_MS = 5e3;
function unreachableMessage(origin, label) {
	return `Can't reach ${label ? `${label} at ${origin}` : origin}. Check that its Overdeck is running and that this computer is on the same tailnet.`;
}
function wrongMachineMessage(origin, newLabel) {
	return `${origin} is now a different Overdeck machine (${newLabel}). Pair again.`;
}
function revokedMessage(label) {
	return `${label} no longer accepts this computer's credential. Pair again with a new link.`;
}
function protocolMessage(label, version) {
	return `${label} speaks Overdeck protocol ${version}; this app supports 1. Update the older side.`;
}
const STORE_DECRYPT_ERROR = "This computer's credential store could not decrypt the saved credential. Pair again.";
/** Production DNS lookup for the transport policy. */
async function lookupAllAddresses(host) {
	return (await node_dns.promises.lookup(host, { all: true })).map((result) => result.address);
}
function deviceLabel() {
	return `Overdeck desktop on ${node_os.hostname()}`.slice(0, 200);
}
async function readJson(response) {
	try {
		const body = await response.json();
		return typeof body === "object" && body !== null ? body : null;
	} catch {
		return null;
	}
}
function mintSession(baseUrl, token, deps) {
	return deps.fetchImpl(`${baseUrl}/api/dashboard/session`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Origin: baseUrl
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
}
async function fetchMachineDescriptor(baseUrl, deps) {
	let body;
	try {
		const response = await deps.fetchImpl(`${baseUrl}/api/environment`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		if (!response.ok) return {
			ok: false,
			error: unreachableMessage(baseUrl)
		};
		body = await readJson(response);
	} catch {
		return {
			ok: false,
			error: unreachableMessage(baseUrl)
		};
	}
	if (!body || body.descriptorVersion !== 1 || typeof body.environmentId !== "string" || typeof body.label !== "string" || typeof body.protocolVersion !== "number") return {
		ok: false,
		error: `${baseUrl} did not answer as an Overdeck machine.`
	};
	const capabilities = body.capabilities;
	return {
		ok: true,
		descriptor: {
			environmentId: body.environmentId,
			label: body.label,
			protocolVersion: body.protocolVersion,
			pairing: capabilities?.pairing === true
		}
	};
}
async function pairWithMachine(linkText, deps) {
	const parsed = parsePairingLink(linkText);
	if (!parsed.ok) return parsed;
	const { baseUrl, credential } = parsed.link;
	const store = credentialStoreStatus();
	if (!store.ok) return store;
	const transport = await assessMachineTransport(baseUrl, deps.lookupAll);
	if (!transport.ok) return transport;
	const described = await fetchMachineDescriptor(baseUrl, deps);
	if (!described.ok) return described;
	const { descriptor } = described;
	if (descriptor.protocolVersion !== 1) return {
		ok: false,
		error: protocolMessage(descriptor.label, descriptor.protocolVersion)
	};
	if (!descriptor.pairing) return {
		ok: false,
		error: `${descriptor.label} does not accept pairing.`
	};
	let response;
	try {
		response = await deps.fetchImpl(`${baseUrl}/api/pairing/exchange`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: baseUrl
			},
			body: JSON.stringify({
				credential,
				label: deviceLabel(),
				delivery: "bearer"
			}),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch {
		return {
			ok: false,
			error: unreachableMessage(baseUrl, descriptor.label)
		};
	}
	const body = await readJson(response);
	if (!response.ok) {
		const serverError = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
		return {
			ok: false,
			error: `Pairing failed: ${serverError}${serverError === "Invalid origin" ? ` Add ${baseUrl} under Settings → Anywhere → trusted addresses on that machine.` : ""}`
		};
	}
	const token = body?.token;
	const deviceId = body?.deviceId;
	if (typeof token !== "string" || !token.startsWith("odk_") || typeof deviceId !== "string") return {
		ok: false,
		error: "Pairing failed: the machine did not return a device credential."
	};
	if (body?.environmentId !== descriptor.environmentId) return {
		ok: false,
		error: wrongMachineMessage(baseUrl, descriptor.label)
	};
	const previous = loadMachineRecord();
	if (previous) try {
		await revokeOwnDevice(previous, readMachineToken(previous), deps);
	} catch {}
	saveMachineRecord({
		active: true,
		baseUrl,
		environmentId: descriptor.environmentId,
		label: descriptor.label,
		deviceId,
		pairedAt: (/* @__PURE__ */ new Date()).toISOString()
	}, token);
	const record = loadMachineRecord();
	if (!record) return {
		ok: false,
		error: "Pairing failed: the machine record could not be saved."
	};
	return {
		ok: true,
		record
	};
}
async function preflightMachine(record, deps) {
	const { baseUrl, label } = record;
	const transport = await assessMachineTransport(baseUrl, deps.lookupAll);
	if (!transport.ok) return {
		ok: false,
		reason: "transport",
		error: transport.error
	};
	const described = await fetchMachineDescriptor(baseUrl, deps);
	if (!described.ok) return {
		ok: false,
		reason: "unreachable",
		error: unreachableMessage(baseUrl, label)
	};
	const { descriptor } = described;
	if (descriptor.environmentId !== record.environmentId) return {
		ok: false,
		reason: "wrong-machine",
		error: wrongMachineMessage(baseUrl, descriptor.label)
	};
	if (descriptor.protocolVersion !== 1) return {
		ok: false,
		reason: "protocol",
		error: protocolMessage(label, descriptor.protocolVersion)
	};
	let token;
	try {
		token = readMachineToken(record);
	} catch {
		return {
			ok: false,
			reason: "store",
			error: STORE_DECRYPT_ERROR
		};
	}
	let response;
	try {
		response = await mintSession(baseUrl, token, deps);
	} catch {
		return {
			ok: false,
			reason: "unreachable",
			error: unreachableMessage(baseUrl, label)
		};
	}
	if (response.status === 200) return {
		ok: true,
		token
	};
	if (response.status === 401 || response.status === 403) return {
		ok: false,
		reason: "revoked",
		error: revokedMessage(label)
	};
	return {
		ok: false,
		reason: "unreachable",
		error: unreachableMessage(baseUrl, label)
	};
}
async function revokeOwnDevice(record, token, deps) {
	try {
		const mint = await mintSession(record.baseUrl, token, deps);
		if (!mint.ok) return false;
		const csrfToken = (await readJson(mint))?.csrfToken;
		if (typeof csrfToken !== "string") return false;
		return (await deps.fetchImpl(`${record.baseUrl}/api/devices/${encodeURIComponent(record.deviceId)}`, {
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				Origin: record.baseUrl,
				"x-overdeck-csrf-token": csrfToken
			},
			body: "{}",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		})).ok;
	} catch {
		return false;
	}
}
//#endregion
//#region src/connect-window.ts
/**
* The connect window: a small local page that takes a pairing link and shows
* the chosen machine's state and errors (PAN-4402 W-5).
*
* It works with no server running anywhere. Its IPC handlers answer only the
* connect window's own webContents, so a dashboard page — local or remote —
* cannot pair, switch or forget (D-8). getState never carries the token.
*/
const CONNECT_IPC = {
	GET_STATE: "pan:connect-get-state",
	PAIR: "pan:connect-pair",
	OPEN_MACHINE: "pan:connect-open-machine",
	USE_LOCAL: "pan:connect-use-local",
	FORGET: "pan:connect-forget",
	STATE_CHANGED: "pan:connect-state-changed"
};
const NOT_ALLOWED = {
	ok: false,
	error: "not allowed"
};
let connectWindow = null;
let lastError = null;
function fromConnectWindow(event) {
	return connectWindow !== null && !connectWindow.isDestroyed() && event.sender === connectWindow.webContents;
}
function notifyStateChanged() {
	if (connectWindow && !connectWindow.isDestroyed()) connectWindow.webContents.send(CONNECT_IPC.STATE_CHANGED);
}
async function runAction(action) {
	try {
		const result = await action();
		lastError = result.ok ? null : result.error;
		return result;
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		lastError = error;
		return {
			ok: false,
			error
		};
	}
}
/** Opens the one connect window, or focuses it and shows the new error. */
function openConnectWindow(error) {
	if (error !== void 0) lastError = error;
	if (connectWindow && !connectWindow.isDestroyed()) {
		notifyStateChanged();
		if (connectWindow.isMinimized()) connectWindow.restore();
		connectWindow.show();
		connectWindow.focus();
		return connectWindow;
	}
	const win = new electron.BrowserWindow({
		width: 520,
		height: 560,
		title: "Open another machine",
		autoHideMenuBar: true,
		webPreferences: {
			preload: node_path.join(__dirname, "connect-preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true
		},
		show: false
	});
	connectWindow = win;
	win.once("ready-to-show", () => win.show());
	win.on("closed", () => {
		if (connectWindow === win) connectWindow = null;
	});
	const page = resolveResourcePath("connect.html");
	if (page) win.loadFile(page);
	else console.error("[desktop] connect.html not found");
	return win;
}
function closeConnectWindow() {
	if (connectWindow && !connectWindow.isDestroyed()) connectWindow.close();
	connectWindow = null;
}
function registerConnectIpc(handlers) {
	electron.ipcMain.handle(CONNECT_IPC.GET_STATE, (event) => {
		if (!fromConnectWindow(event)) return NOT_ALLOWED;
		const { mode, machine, canUseThisComputer } = handlers.getState();
		return {
			mode,
			machine: machine ? {
				label: machine.label,
				baseUrl: machine.baseUrl
			} : null,
			canUseThisComputer,
			error: lastError
		};
	});
	electron.ipcMain.handle(CONNECT_IPC.PAIR, (event, link) => {
		if (!fromConnectWindow(event)) return NOT_ALLOWED;
		if (typeof link !== "string") return {
			ok: false,
			error: "That is not an Overdeck pairing link."
		};
		return runAction(() => handlers.pair(link));
	});
	electron.ipcMain.handle(CONNECT_IPC.OPEN_MACHINE, (event) => {
		if (!fromConnectWindow(event)) return NOT_ALLOWED;
		return runAction(() => handlers.openMachine());
	});
	electron.ipcMain.handle(CONNECT_IPC.USE_LOCAL, (event) => {
		if (!fromConnectWindow(event)) return NOT_ALLOWED;
		return runAction(() => handlers.useLocal());
	});
	electron.ipcMain.handle(CONNECT_IPC.FORGET, (event) => {
		if (!fromConnectWindow(event)) return NOT_ALLOWED;
		return runAction(() => handlers.forget());
	});
}
//#endregion
//#region src/main.ts
const ROOT_DIR = node_path.resolve(__dirname, "../../..");
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment ? "Overdeck (Dev)" : "Overdeck";
const APP_ID = "com.overdeck.app";
const LINUX_WM_CLASS = isDevelopment ? "overdeck-dev" : "overdeck";
const DESKTOP_SCHEME = "overdeck";
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
	QUIT_AND_INSTALL: "pan:quit-and-install",
	RESTART_DASHBOARD: "pan:restart-dashboard"
};
let mainWindow = null;
let serverPort = 0;
let serverUrl = "";
let serverWsUrl = "";
let isQuitting = false;
const terminalWindows = /* @__PURE__ */ new Map();
let localServerStarted = false;
let autoStartNagHandled = false;
/** Set by Use This Computer: close the connect window once the local window opens. */
let closeConnectWhenLocalReady = false;
const machineClientDeps = {
	fetchImpl: (input, init) => fetch(input, init),
	lookupAll: lookupAllAddresses
};
if (!electron.app.requestSingleInstanceLock()) electron.app.exit(0);
electron.app.on("second-instance", () => showOrCreateWindow());
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
	const active = getActiveDashboard();
	if (active.kind === "remote") return active.baseUrl;
	if (serverUrl) return serverUrl;
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
			sandbox: false,
			...remotePartitionPreference()
		},
		show: false
	});
	guardRemoteNavigation(win);
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
		await openExternalSafe(url);
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
	electron.ipcMain.handle(IPC.RESTART_DASHBOARD, async () => {
		const active = getActiveDashboard();
		if (active.kind === "remote") throw new Error(`This window shows ${active.label}. Restart its dashboard on that machine.`);
		console.log("[main] manual dashboard restart requested");
		stopServer();
		await new Promise((resolve) => setTimeout(resolve, 500));
		startServer((port, wsUrl) => {
			serverPort = port;
			serverUrl = `http://127.0.0.1:${port}`;
			serverWsUrl = wsUrl;
			setLocalDashboard(serverUrl);
			console.log(`[main] dashboard restarted on ${serverUrl}`);
		});
	});
	registerConnectIpc({
		getState: () => {
			const record = loadMachineRecord();
			return {
				mode: getActiveDashboard().kind,
				machine: record ? {
					label: record.label,
					baseUrl: record.baseUrl
				} : null,
				canUseThisComputer: getActiveDashboard().kind === "remote" || !localServerStarted
			};
		},
		pair: async (link) => {
			const result = await pairWithMachine(link, machineClientDeps);
			if (!result.ok) return result;
			return openRemoteDashboard(result.record);
		},
		openMachine: async () => {
			const record = loadMachineRecord();
			if (!record) return {
				ok: false,
				error: "No machine is paired with this computer."
			};
			return openRemoteDashboard(record);
		},
		useLocal: async () => switchToLocal({ closeConnectWindow: true }),
		forget: async () => forgetMachine()
	});
}
async function openExternalSafe(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
	await electron.shell.openExternal(parsed.toString());
}
function remotePartitionPreference() {
	const active = getActiveDashboard();
	return active.kind === "remote" ? { partition: active.partition } : {};
}
/** D-9: a remote window stays on the chosen machine; other origins open in the browser. */
function guardRemoteNavigation(win) {
	const active = getActiveDashboard();
	if (active.kind !== "remote") return;
	const base = active.baseUrl;
	const keepOnMachine = (event) => {
		if (isSameOrigin(event.url, base)) return;
		event.preventDefault();
		openExternalSafe(event.url);
	};
	win.webContents.on("will-navigate", keepOnMachine);
	win.webContents.on("will-redirect", keepOnMachine);
	win.webContents.on("did-create-window", (child) => guardRemoteNavigation(child));
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (isSameOrigin(url, base)) return { action: "allow" };
		openExternalSafe(url);
		return { action: "deny" };
	});
}
/** A window's partition cannot change, so a mode switch recreates every dashboard window (H-4). */
function destroyDashboardWindows() {
	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
	mainWindow = null;
	for (const win of terminalWindows.values()) if (!win.isDestroyed()) win.destroy();
	terminalWindows.clear();
}
function refreshModeUi() {
	refreshApplicationMenu();
	refreshTrayMode();
}
function startLocalServer() {
	localServerStarted = true;
	startServer(onLocalServerReady);
}
function stopLocalServer() {
	localServerStarted = false;
	stopServer();
}
function handleAutoStartNagOnce() {
	if (autoStartNagHandled) return;
	autoStartNagHandled = true;
	handleAutoStartNag();
}
function onLocalServerReady(port, wsUrl) {
	serverPort = port;
	serverUrl = `http://127.0.0.1:${port}`;
	serverWsUrl = wsUrl;
	if (getActiveDashboard().kind === "remote") return;
	setLocalDashboard(serverUrl);
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.loadURL(resolveWindowUrl());
		return;
	}
	mainWindow = createWindow();
	handleAutoStartNagOnce();
	if (closeConnectWhenLocalReady) {
		closeConnectWhenLocalReady = false;
		closeConnectWindow();
	}
}
/** D-6: preflight first; only a 200 session mint stops the local server and opens the machine. */
async function openRemoteDashboard(record) {
	const result = await preflightMachine(record, machineClientDeps);
	if (!result.ok) {
		openConnectWindow(result.error);
		return {
			ok: false,
			error: result.error
		};
	}
	const previous = getActiveDashboard();
	setRemoteDashboard(record, result.token);
	const active = getActiveDashboard();
	try {
		if (active.kind === "remote") await prepareRemoteSession(active);
	} catch (err) {
		if (previous.kind === "local") setLocalDashboard(previous.baseUrl);
		const error = err instanceof Error ? err.message : String(err);
		openConnectWindow(error);
		return {
			ok: false,
			error
		};
	}
	stopLocalServer();
	setMachineActive(true);
	closeConnectWhenLocalReady = false;
	destroyDashboardWindows();
	mainWindow = createWindow();
	handleAutoStartNagOnce();
	closeConnectWindow();
	refreshModeUi();
	return { ok: true };
}
/**
* Use This Computer: mark the record inactive and run the embedded server.
* The connect window stays open until the local window exists, so closing it
* never leaves the app with no window (window-all-closed would quit).
*/
function switchToLocal(options) {
	setMachineActive(false);
	if (getActiveDashboard().kind === "local" && localServerStarted) {
		if (options.closeConnectWindow) closeConnectWindow();
		refreshModeUi();
		return { ok: true };
	}
	openConnectWindow();
	destroyDashboardWindows();
	serverUrl = "";
	setLocalDashboard("");
	closeConnectWhenLocalReady = options.closeConnectWindow;
	startLocalServer();
	refreshModeUi();
	return { ok: true };
}
/** FR-9: best-effort self-revoke, then delete the record whatever the result. */
async function forgetMachine() {
	const record = loadMachineRecord();
	if (!record) return switchToLocal({ closeConnectWindow: false });
	let revoked = false;
	try {
		revoked = await revokeOwnDevice(record, readMachineToken(record), machineClientDeps);
	} catch {
		revoked = false;
	}
	deleteMachineRecord();
	switchToLocal({ closeConnectWindow: false });
	if (revoked) return { ok: true };
	return {
		ok: true,
		message: `Removed from this computer. ${record.label} could not be reached; revoke "${deviceLabel()}" in its Settings → Anywhere → Devices.`
	};
}
function openConnectWindowFromMenu() {
	openConnectWindow();
}
function useThisComputer() {
	switchToLocal({ closeConnectWindow: true });
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
			sandbox: false,
			...remotePartitionPreference()
		},
		show: false
	});
	guardRemoteNavigation(win);
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
	if (!getActiveDashboard().baseUrl) return;
	dashboardFetch(path, { method }).catch((err) => {
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
	const plan = planBoot(loadMachineRecord(), isDevelopment);
	if (plan.kind === "remote") openRemoteDashboard(plan.record);
	else startLocalServer();
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
exports.openConnectWindowFromMenu = openConnectWindowFromMenu;
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
exports.useThisComputer = useThisComputer;

//# sourceMappingURL=main.js.map