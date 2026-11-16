#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { access, lstat, readFile, readlink, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
//#region semgrep-edit-hook.ts
const execFileAsync = promisify(execFile);
const SKIP_EXTENSIONS = new Set([
	".md",
	".mdx",
	".markdown",
	".txt",
	".rst",
	".csv",
	".tsv",
	".log",
	".lock",
	".svg",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".pdf",
	".snap",
	".map"
]);
const MAX_FILE_SIZE = 1048576;
const MAX_FINDINGS = 10;
async function defaultExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
/** The env the scan child gets: `base` minus SEMGREP_APP_TOKEN/SEMGREP_RULES, plus quiet + Overdeck-owned state paths. */
function semgrepScanEnv(base, home) {
	const env = {};
	for (const [key, value] of Object.entries(base)) if (value !== void 0) env[key] = value;
	delete env.SEMGREP_APP_TOKEN;
	delete env.SEMGREP_RULES;
	const toolsDir = join(home, "tools", "semgrep");
	env.SEMGREP_ENABLE_VERSION_CHECK = "0";
	env.SEMGREP_SEND_METRICS = "off";
	env.SEMGREP_SETTINGS_FILE = join(toolsDir, "settings.yml");
	env.SEMGREP_LOG_FILE = join(toolsDir, "semgrep.log");
	return env;
}
function formatFinding(finding) {
	const line = finding.start?.line ?? "?";
	const severity = finding.extra?.severity ?? "";
	const message = (finding.extra?.message ?? "").split("\n")[0]?.slice(0, 200) ?? "";
	return `- line ${line}: ${finding.check_id} [${severity}] ${message}`;
}
/** Returns the hook's stdout ('' for no output). Never throws. */
async function runSemgrepEditHook(input, env, deps = {}) {
	try {
		if (env.OVERDECK_DOCKER_WORKSPACE === "1" || env.PAN_DOCKER === "1") return "";
		let event;
		try {
			event = JSON.parse(input);
		} catch {
			return "";
		}
		if (event.tool_name !== "Edit" && event.tool_name !== "Write" && event.tool_name !== "MultiEdit") return "";
		const agentId = env.OVERDECK_AGENT_ID;
		if (!agentId) return "";
		const home = env.OVERDECK_HOME || join(env.HOME ?? homedir(), ".overdeck");
		const exists = deps.exists ?? defaultExists;
		const readFile$1 = deps.readFile ?? ((path) => readFile(path, "utf8"));
		const statePath = join(home, "agents", agentId, "state.json");
		if (!await exists(statePath)) return "";
		let role;
		try {
			const raw = await readFile$1(statePath);
			role = JSON.parse(raw).role;
		} catch {
			return "";
		}
		if (role !== "work") return "";
		const filePathRaw = event.tool_input?.file_path;
		if (typeof filePathRaw !== "string" || filePathRaw.length === 0) return "";
		const cwd = typeof event.cwd === "string" && event.cwd.length > 0 ? event.cwd : process.cwd();
		const file = isAbsolute(filePathRaw) ? filePathRaw : join(cwd, filePathRaw);
		if (file.includes("/node_modules/") || file.includes("/.git/") || file.includes("/dist/")) return "";
		if (SKIP_EXTENSIONS.has(extname(file).toLowerCase())) return "";
		const stat$1 = deps.stat ?? stat;
		let fileStat;
		try {
			fileStat = await stat$1(file);
		} catch {
			return "";
		}
		if (!fileStat.isFile() || fileStat.size > MAX_FILE_SIZE) return "";
		const lstat$1 = deps.lstat ?? lstat;
		const readlink$1 = deps.readlink ?? readlink;
		const bin = join(home, "bin", "semgrep");
		const expectedTarget = join(home, "tools", "semgrep", "bin", "semgrep");
		try {
			if (!(await lstat$1(bin)).isSymbolicLink()) return "";
			if (await readlink$1(bin) !== expectedTarget) return "";
		} catch {
			return "";
		}
		const configs = ["--config", "p/default"];
		if (await exists(join(cwd, ".semgrep.yml"))) configs.push("--config", join(cwd, ".semgrep.yml"));
		if (await exists(join(cwd, ".semgrep"))) configs.push("--config", join(cwd, ".semgrep"));
		const execFile = deps.execFile ?? execFileAsync;
		let stdout;
		try {
			stdout = (await execFile(bin, [
				"scan",
				"--json",
				"--quiet",
				"--metrics=off",
				...configs,
				file
			], {
				cwd,
				env: semgrepScanEnv(env, home),
				timeout: 3e4,
				maxBuffer: 8 * 1024 * 1024
			})).stdout;
		} catch (error) {
			const err = error;
			if (err.code === 1 && typeof err.stdout === "string") stdout = err.stdout;
			else return "";
		}
		let parsed;
		try {
			parsed = JSON.parse(stdout);
		} catch {
			return "";
		}
		const results = parsed.results ?? [];
		if (results.length === 0) return "";
		const lines = results.slice(0, MAX_FINDINGS).map(formatFinding);
		if (results.length > MAX_FINDINGS) lines.push(`…and ${results.length - MAX_FINDINGS} more`);
		const text = [
			`Semgrep found ${results.length} issue(s) in ${relative(cwd, file)}:`,
			...lines,
			"Fix each one. If one is a false positive, add `nosemgrep: <rule-id>` with a one-line reason on that line (see the semgrep skill)."
		].join("\n");
		return JSON.stringify({ hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: text
		} });
	} catch {
		return "";
	}
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runSemgrepEditHook(readFileSync(0, "utf-8"), process.env).then((output) => {
	if (output) process.stdout.write(output);
}).catch(() => void 0).finally(() => process.exit(0));
//#endregion
export { runSemgrepEditHook, semgrepScanEnv };

//# sourceMappingURL=semgrep-edit-hook.js.map