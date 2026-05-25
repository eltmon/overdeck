import { ArtifactIndexRepository, type ArtifactIndexEntry } from '../../../lib/artifacts/index-store.js';

export function getArtifactBySlugJob(slug: string): ArtifactIndexEntry | null {
  const repository = new ArtifactIndexRepository();
  try {
    return repository.getBySlug(slug);
  } finally {
    repository.close();
  }
}

export function listArtifactsForWorkspaceOrIssueJob(selector: string): ArtifactIndexEntry[] {
  const repository = new ArtifactIndexRepository();
  try {
    const seen = new Set<string>();
    const entries: ArtifactIndexEntry[] = [];
    for (const entry of [...repository.listByWorkspace(selector), ...repository.listByIssue(selector)]) {
      if (seen.has(entry.artifact.artifactId)) continue;
      seen.add(entry.artifact.artifactId);
      entries.push(entry);
    }
    return entries.sort((a, b) => b.artifact.createdAt.localeCompare(a.artifact.createdAt));
  } finally {
    repository.close();
  }
}

export function unshareArtifactBySlugJob(slug: string): ArtifactIndexEntry | null {
  const repository = new ArtifactIndexRepository();
  try {
    const existing = repository.getBySlug(slug);
    if (!existing) return null;
    return repository.unshare(existing.artifact.artifactId);
  } finally {
    repository.close();
  }
}
