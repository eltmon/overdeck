/**
 * Every /api/orders* route is project-scoped through ?project=<key>, so the
 * Order Book page can only read and write one project's books at a time. Once a
 * project is resolved, every fetch the page and its rails make must carry the
 * same key — a scoped read paired with an unscoped mutation would land in two
 * different state roots (PAN-3427).
 */
export function withProject(url: string, projectKey: string | null | undefined): string {
  if (!projectKey) return url;
  return `${url}${url.includes('?') ? '&' : '?'}project=${encodeURIComponent(projectKey)}`;
}
