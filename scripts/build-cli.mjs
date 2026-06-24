import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const distDir = join(projectRoot, 'dist');
const dashboardDir = join(distDir, 'dashboard');
const promptsDir = join(distDir, 'prompts');
const cliPromptsDir = join(distDir, 'cli', 'prompts');
const preservedRoot = join(projectRoot, '.tmp', `overdeck-dashboard-${process.pid}-${Date.now()}`);
const preservedDashboardDir = join(preservedRoot, 'dashboard');

const moveDirSync = (src, dst) => {
  try {
    renameSync(src, dst);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }

    cpSync(src, dst, { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
};

const restoreDashboard = () => {
  if (!existsSync(preservedDashboardDir)) {
    return;
  }

  mkdirSync(distDir, { recursive: true });
  if (existsSync(dashboardDir)) {
    rmSync(dashboardDir, { recursive: true, force: true });
  }
  moveDirSync(preservedDashboardDir, dashboardDir);
};

const copyMatching = (srcDir, dstDir, predicate) => {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile() || !predicate(entry.name)) continue;
    cpSync(join(srcDir, entry.name), join(dstDir, entry.name));
  }
};

const copyCavemanAssets = () => {
  const cavemanSrc = join(projectRoot, 'src', 'lib', 'caveman');
  const cavemanDst = join(distDir, 'cli', 'caveman');
  const cavemanCompressSrc = join(cavemanSrc, 'compress');
  const cavemanCompressDst = join(distDir, 'cli', 'caveman-compress');

  copyMatching(cavemanSrc, cavemanDst, (name) => name.endsWith('.js') || name === 'caveman-statusline.sh');

  const skillSrc = join(cavemanSrc, 'skills', 'caveman', 'SKILL.md');
  const skillDst = join(cavemanDst, 'skills', 'caveman', 'SKILL.md');
  mkdirSync(join(cavemanDst, 'skills', 'caveman'), { recursive: true });
  cpSync(skillSrc, skillDst);

  const reviewSkillSrc = join(cavemanSrc, 'skills', 'caveman-review', 'SKILL.md');
  const reviewSkillDst = join(cavemanDst, 'skills', 'caveman-review', 'SKILL.md');
  mkdirSync(join(cavemanDst, 'skills', 'caveman-review'), { recursive: true });
  cpSync(reviewSkillSrc, reviewSkillDst);

  copyMatching(cavemanCompressSrc, cavemanCompressDst, (name) => name.endsWith('.py'));

  // Mirror at dist/caveman and dist/caveman-compress for legacy resolution paths.
  const cavemanMirror = join(distDir, 'caveman');
  const cavemanCompressMirror = join(distDir, 'caveman-compress');
  if (existsSync(cavemanMirror)) rmSync(cavemanMirror, { recursive: true, force: true });
  if (existsSync(cavemanCompressMirror)) rmSync(cavemanCompressMirror, { recursive: true, force: true });
  cpSync(cavemanDst, cavemanMirror, { recursive: true });
  cpSync(cavemanCompressDst, cavemanCompressMirror, { recursive: true });
};

const copyCloisterPrompts = () => {
  const cloisterPromptsSrc = join(projectRoot, 'src', 'lib', 'cloister', 'prompts');
  copyMatching(cloisterPromptsSrc, promptsDir, (name) => name.endsWith('.md'));
  copyMatching(cloisterPromptsSrc, cliPromptsDir, (name) => name.endsWith('.md'));
};

// PAN-1989: ship the vendored pi/ohmypi extension bundles inside dist/ so
// packed installs (npm pack) include them — package.json's `files` array ships
// dist/ but NOT packages/. Runtime resolution (src/lib/paths.ts) looks for these
// copies first, falling back to the raw packages/ build in a dev checkout.
const copyExtensionBundles = () => {
  const extDstDir = join(distDir, 'extensions');
  mkdirSync(extDstDir, { recursive: true });
  const bundles = [
    ['ohmypi-extension/dist/index.js', 'ohmypi.js'],
    ['pi-extension/dist/index.js', 'pi.js'],
  ];
  for (const [src, dst] of bundles) {
    const srcPath = join(projectRoot, 'packages', src);
    if (!existsSync(srcPath)) {
      throw new Error(
        `[build-cli] extension bundle missing: ${srcPath} (run npm run build:ohmypi-extension && npm run build:pi-extension first)`,
      );
    }
    cpSync(srcPath, join(extDstDir, dst));
  }
};

try {
  if (existsSync(dashboardDir)) {
    mkdirSync(preservedRoot, { recursive: true });
    moveDirSync(dashboardDir, preservedDashboardDir);
  }

  const build = spawnSync('tsdown', { cwd: projectRoot, stdio: 'inherit', shell: true });
  if (build.status !== 0) {
    restoreDashboard();
    process.exit(build.status ?? 1);
  }

  restoreDashboard();

  copyCloisterPrompts();
  copyCavemanAssets();
  copyExtensionBundles();
} finally {
  rmSync(preservedRoot, { recursive: true, force: true });
}
