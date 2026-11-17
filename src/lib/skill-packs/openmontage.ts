/**
 * The OpenMontage known pack's curation (PAN-5464), frozen at eltmon/OpenMontage 2e003e6.
 *
 * `.agents/skills/` holds 92 skills. The pack mounts the 38 that work outside an OpenMontage checkout
 * and excludes the rest. A conversation opened inside an OpenMontage checkout still sees the excluded
 * skills there, through the repo's own `.agents/skills`.
 */

export const OPENMONTAGE_EXCLUDED_NAMES: readonly string[] = [
  // 1. Duplicates and generic web skills that other packs or the operator's global skills provide
  //    (`gsap` holds only a README, no SKILL.md).
  'gsap',
  'gsap-core',
  'gsap-frameworks',
  'gsap-performance',
  'gsap-plugins',
  'gsap-react',
  'gsap-scrolltrigger',
  'gsap-timeline',
  'gsap-utils',
  'hyperframes',
  'hyperframes-animation',
  'hyperframes-cli',
  'hyperframes-core',
  'hyperframes-creative',
  'hyperframes-media',
  'hyperframes-registry',
  'remotion',
  'remotion-best-practices',
  'remotion-to-hyperframes',
  'threejs-animation',
  'threejs-fundamentals',
  'threejs-geometry',
  'threejs-interaction',
  'threejs-lighting',
  'threejs-loaders',
  'threejs-materials',
  'threejs-postprocessing',
  'threejs-shaders',
  'threejs-textures',
  'threejs-world-generation',
  'media-use',
  'tailwind-design-system',
  'vercel-composition-patterns',
  'vercel-react-best-practices',
  'web-design-guidelines',
  'beautiful-mermaid',
  'd3-viz',
  'framer-motion',
  // 2. OpenMontage repo maintenance.
  'agents',
  'provider-model-refresh',
  'provider-refresh-oct23',
  // 3. Repo-bound: the description says it is for OpenMontage, or the body runs OpenMontage code
  //    (`from tools.…`, `python tools/…`, `remotion-composer/…`, root `lib/…`).
  'acestep',
  'azure-speech-to-text',
  'azure-text-to-speech',
  'dashscope',
  'doubao-tts',
  'fish-audio-tts',
  'kling-official',
  'ltx2',
  'seedance-2-0',
  'synthetic-screen-recording',
  'video-toolkit',
  '3d-asset-generation',
  'comfyui',
  'lyria',
];

/** Repo-relative dirs the `openmontage` known pack's skill scan skips. */
export const OPENMONTAGE_EXCLUDE: readonly string[] = OPENMONTAGE_EXCLUDED_NAMES.map((name) => `.agents/skills/${name}`);

export const OPENMONTAGE_DISCLOSURE =
  'OpenMontage provider skills call paid generation APIs (ElevenLabs, HeyGen, Kling, Seedance and others) only with keys you set. AGPL-3.0.';
