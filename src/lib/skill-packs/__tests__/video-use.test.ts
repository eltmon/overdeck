/**
 * PAN-5464 WI-6: the video-use host notice and requirements.txt generation.
 */
import { describe, expect, it } from 'vitest';
import { applyVideoUseHostNotice, requirementsFromPyproject, VIDEO_USE_HOST_NOTICE } from '../video-use.js';

const MARKER = '<!-- overdeck:video-use-host-notice v1 -->';

// pyproject.toml of eltmon/video-use at 43cfc566833548093455c9d4a46bd69913b7e552.
const PINNED_PYPROJECT = `[project]
name = "video-use"
version = "0.1.0"
description = "Conversation-driven video editor skill for Claude Code"
license = { file = "LICENSE" }
requires-python = ">=3.10"
dependencies = [
    "requests",
    "librosa",
    "matplotlib",
    "pillow",
    "numpy",
]

[project.optional-dependencies]
animations = ["manim"]

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[tool.setuptools]
py-modules = []
`;

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('applyVideoUseHostNotice', () => {
  const skillMd = '---\nname: video-use\ndescription: Edit any video by conversation.\n---\n\n# Video Use\n';

  it('inserts the notice once after the frontmatter and keeps the frontmatter', () => {
    const out = applyVideoUseHostNotice(skillMd);
    expect(out.startsWith('---\nname: video-use\ndescription: Edit any video by conversation.\n---\n')).toBe(true);
    expect(count(out, MARKER)).toBe(1);
    expect(out.indexOf(MARKER)).toBeLessThan(out.indexOf('# Video Use'));
    expect(out).toContain(VIDEO_USE_HOST_NOTICE);
    expect(out).toContain('request_secret');
  });

  it('is a no-op on a SKILL.md that already holds the notice', () => {
    const once = applyVideoUseHostNotice(skillMd);
    expect(applyVideoUseHostNotice(once)).toBe(once);
  });

  it('points the vendored manim-video references at the mounted sibling skill', () => {
    const pinned = `${skillMd}\n- This skill vendors \`skills/manim-video/\`. Read its SKILL.md.\n- **Manim**: read \`skills/manim-video/SKILL.md\`.\n`;
    const out = applyVideoUseHostNotice(pinned);
    expect(out).not.toContain('skills/manim-video/');
    expect(out).toContain('This skill vendors `../manim-video/`.');
    expect(out).toContain('read `../manim-video/SKILL.md`');
    expect(applyVideoUseHostNotice(out)).toBe(out);
  });

  it('puts the notice at the top when there is no frontmatter', () => {
    const out = applyVideoUseHostNotice('# Video Use\n');
    expect(out.startsWith(MARKER)).toBe(true);
    expect(out.endsWith('# Video Use\n')).toBe(true);
  });
});

describe('requirementsFromPyproject', () => {
  it('lists the pinned project dependencies one per line', () => {
    expect(requirementsFromPyproject(PINNED_PYPROJECT)).toBe('requests\nlibrosa\nmatplotlib\npillow\nnumpy\n');
  });

  it('returns an empty string without project dependencies', () => {
    expect(requirementsFromPyproject('[project]\nname = "x"\n')).toBe('');
    expect(requirementsFromPyproject('[tool.x]\ny = 1\n')).toBe('');
  });
});
