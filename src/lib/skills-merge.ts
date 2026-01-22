import {
  existsSync,
  readdirSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { SKILLS_DIR } from './paths.js';

type ContentOrigin = 'git-tracked' | 'panopticon' | 'user-untracked';

function detectContentOrigin(path: string, repoPath: string): ContentOrigin {
  try {
    const stat = lstatSync(path);

    // Check if symlink pointing to panopticon
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      if (target.includes('.panopticon')) {
        return 'panopticon';
      }
    }

    // Check if git-tracked
    try {
      execSync(`git ls-files --error-unmatch "${path}" 2>/dev/null`, {
        cwd: repoPath,
        stdio: 'pipe',
      });
      return 'git-tracked';
    } catch {
      return 'user-untracked';
    }
  } catch {
    return 'user-untracked';
  }
}

export function mergeSkillsIntoWorkspace(workspacePath: string): {
  added: string[];
  skipped: string[];
} {
  const skillsTarget = join(workspacePath, '.claude', 'skills');
  const added: string[] = [];
  const skipped: string[] = [];

  // Ensure target directory exists
  mkdirSync(skillsTarget, { recursive: true });

  // Get existing skills in workspace
  const existingSkills = new Set<string>();
  if (existsSync(skillsTarget)) {
    for (const item of readdirSync(skillsTarget)) {
      existingSkills.add(item);
    }
  }

  // Get panopticon skills
  if (!existsSync(SKILLS_DIR)) return { added, skipped };

  const panopticonSkills = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const skill of panopticonSkills) {
    const targetPath = join(skillsTarget, skill);
    const sourcePath = join(SKILLS_DIR, skill);

    // Skip if exists and is git-tracked
    if (existingSkills.has(skill)) {
      const origin = detectContentOrigin(targetPath, workspacePath);
      if (origin === 'git-tracked') {
        skipped.push(`${skill} (git-tracked)`);
        continue;
      }
      if (origin === 'panopticon') {
        // Already ours, skip silently
        continue;
      }
    }

    // Create symlink
    try {
      symlinkSync(sourcePath, targetPath);
      added.push(skill);
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        // If exists but not symlink, skip
        skipped.push(`${skill} (exists)`);
      }
    }
  }

  // Update .gitignore if we added anything
  if (added.length > 0) {
    updateGitignore(skillsTarget, added);
  }

  return { added, skipped };
}

/**
 * Header comment for Panopticon-managed section in .gitignore
 */
const PANOPTICON_GITIGNORE_HEADER = '# Panopticon-managed symlinks (not committed)';

/**
 * Parse a .gitignore file into sections
 *
 * A section is either:
 * - A header comment followed by entries (until next blank line or header)
 * - Standalone entries without a header
 *
 * @param content - The .gitignore file content
 * @returns Parsed sections with their entries
 */
function parseGitignore(content: string): {
  panopticonEntries: Set<string>;
  otherContent: string[];
  hasPanopticonSection: boolean;
} {
  const lines = content.split('\n');
  const panopticonEntries = new Set<string>();
  const otherContent: string[] = [];
  let inPanopticonSection = false;
  let hasPanopticonSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for Panopticon header
    if (trimmed === PANOPTICON_GITIGNORE_HEADER) {
      inPanopticonSection = true;
      hasPanopticonSection = true;
      continue;
    }

    // If we hit another header comment while in Panopticon section, exit it
    if (inPanopticonSection && trimmed.startsWith('#') && trimmed !== '') {
      inPanopticonSection = false;
      otherContent.push(line);
      continue;
    }

    // If in Panopticon section, collect entries (non-empty, non-comment lines)
    if (inPanopticonSection) {
      if (trimmed !== '' && !trimmed.startsWith('#')) {
        panopticonEntries.add(trimmed);
      }
      // Skip empty lines within Panopticon section (don't add to other content)
      continue;
    }

    // Everything else goes to other content
    otherContent.push(line);
  }

  return { panopticonEntries, otherContent, hasPanopticonSection };
}

/**
 * Update .gitignore to include skill symlinks, with proper deduplication
 *
 * This function intelligently manages the Panopticon section:
 * - Creates it if it doesn't exist
 * - Adds only new entries that aren't already present
 * - Preserves all other user content
 * - Maintains sorted order within the Panopticon section
 *
 * @param skillsDir - The .claude/skills directory path
 * @param skills - Array of skill names to ensure are in .gitignore
 */
function updateGitignore(skillsDir: string, skills: string[]): void {
  const gitignorePath = join(skillsDir, '.gitignore');

  // Read existing content
  let existingContent = '';
  if (existsSync(gitignorePath)) {
    try {
      existingContent = readFileSync(gitignorePath, 'utf-8');
    } catch {
      // If we can't read, start fresh
      existingContent = '';
    }
  }

  // Parse existing content
  const { panopticonEntries, otherContent, hasPanopticonSection } = parseGitignore(existingContent);

  // Add new skills to the set (deduplication happens automatically)
  for (const skill of skills) {
    panopticonEntries.add(skill);
  }

  // If no new entries were added and section already exists, nothing to do
  if (hasPanopticonSection && skills.every(s => panopticonEntries.has(s))) {
    // Check if we already had all these entries before
    const originalEntries = parseGitignore(existingContent).panopticonEntries;
    if (skills.every(s => originalEntries.has(s))) {
      return; // Nothing new to add
    }
  }

  // Build the new content
  const sortedEntries = Array.from(panopticonEntries).sort();

  // Construct the Panopticon section
  const panopticonSection = [
    PANOPTICON_GITIGNORE_HEADER,
    ...sortedEntries,
  ].join('\n');

  // Remove trailing empty lines from other content
  while (otherContent.length > 0 && otherContent[otherContent.length - 1].trim() === '') {
    otherContent.pop();
  }

  // Combine: other content + blank line + Panopticon section
  let newContent: string;
  if (otherContent.length > 0) {
    newContent = otherContent.join('\n') + '\n' + panopticonSection + '\n';
  } else {
    newContent = panopticonSection + '\n';
  }

  try {
    writeFileSync(gitignorePath, newContent, 'utf-8');
  } catch {
    // Ignore errors writing .gitignore
  }
}

/**
 * Clean up a .gitignore file by deduplicating the Panopticon section
 *
 * This is useful for fixing .gitignore files that were corrupted by
 * the old appendFileSync-based implementation that didn't deduplicate.
 *
 * @param gitignorePath - Path to the .gitignore file
 * @returns Object with cleanup results
 */
export function cleanupGitignore(gitignorePath: string): {
  cleaned: boolean;
  duplicatesRemoved: number;
  entriesAfter: number;
} {
  if (!existsSync(gitignorePath)) {
    return { cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 };
  }

  let content: string;
  try {
    content = readFileSync(gitignorePath, 'utf-8');
  } catch {
    return { cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 };
  }

  // Count all occurrences (including duplicates) before cleanup
  const lines = content.split('\n');
  let totalEntriesBeforeDedup = 0;
  let inPanopticonSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === PANOPTICON_GITIGNORE_HEADER) {
      inPanopticonSection = true;
      continue;
    }
    if (inPanopticonSection && trimmed.startsWith('#') && trimmed !== '') {
      inPanopticonSection = false;
    }
    if (inPanopticonSection && trimmed !== '' && !trimmed.startsWith('#')) {
      totalEntriesBeforeDedup++;
    }
  }

  // Parse and deduplicate
  const { panopticonEntries, otherContent, hasPanopticonSection } = parseGitignore(content);

  if (!hasPanopticonSection) {
    return { cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 };
  }

  const duplicatesRemoved = totalEntriesBeforeDedup - panopticonEntries.size;

  if (duplicatesRemoved === 0) {
    return { cleaned: false, duplicatesRemoved: 0, entriesAfter: panopticonEntries.size };
  }

  // Rebuild the file
  const sortedEntries = Array.from(panopticonEntries).sort();
  const panopticonSection = [
    PANOPTICON_GITIGNORE_HEADER,
    ...sortedEntries,
  ].join('\n');

  // Remove trailing empty lines from other content
  while (otherContent.length > 0 && otherContent[otherContent.length - 1].trim() === '') {
    otherContent.pop();
  }

  let newContent: string;
  if (otherContent.length > 0) {
    newContent = otherContent.join('\n') + '\n' + panopticonSection + '\n';
  } else {
    newContent = panopticonSection + '\n';
  }

  try {
    writeFileSync(gitignorePath, newContent, 'utf-8');
    return { cleaned: true, duplicatesRemoved, entriesAfter: panopticonEntries.size };
  } catch {
    return { cleaned: false, duplicatesRemoved: 0, entriesAfter: panopticonEntries.size };
  }
}

/**
 * Clean up .gitignore files in a workspace's .claude/skills directory
 *
 * @param workspacePath - Path to the workspace
 * @returns Cleanup results
 */
export function cleanupWorkspaceGitignore(workspacePath: string): {
  cleaned: boolean;
  duplicatesRemoved: number;
  entriesAfter: number;
} {
  const gitignorePath = join(workspacePath, '.claude', 'skills', '.gitignore');
  return cleanupGitignore(gitignorePath);
}
