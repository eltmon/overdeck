import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, Loader2, X } from 'lucide-react';
import { formatRelativeTime } from '../../../lib/dashboard-utils';

/**
 * ProjectReleasePanel (PAN-2555) — release/publish pipeline visibility on the
 * project HOME tab. Shows the latest npm dist-tag(s), the most recent
 * release-workflow run (live while in progress), and job-level failures so a
 * PARTIAL failure (npm published, a desktop matrix job failed, GitHub Release
 * skipped) is distinguishable from a clean success. Read-only; every element
 * deep-links to GitHub / npm. Renders nothing for projects with no publish
 * pipeline (available=false) — absence is the deliberate empty state.
 */

interface ReleaseWorkflowJob {
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string | null;
}

interface ReleaseWorkflowRun {
  id: number;
  displayTitle: string;
  tag: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectReleaseStatus {
  projectKey: string;
  available: boolean;
  reason?: string;
  repo: string | null;
  releaseWorkflow: string | null;
  runs: ReleaseWorkflowRun[];
  latestRunJobs: ReleaseWorkflowJob[];
  npmPackages: Array<{ name: string; latestVersion: string | null; url: string; error?: string }>;
  githubRelease: { tagName: string; htmlUrl: string } | null;
  error?: string;
}

function useProjectReleaseStatusQuery(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['projectReleaseStatus', projectKey],
    queryFn: async (): Promise<ProjectReleaseStatus> => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey!)}/release-status`);
      if (!res.ok) throw new Error('Failed to fetch release status');
      return res.json();
    },
    enabled: !!projectKey,
    refetchInterval: 30_000,
  });
}

function isJobFailed(job: ReleaseWorkflowJob): boolean {
  const conclusion = (job.conclusion ?? '').toLowerCase();
  return conclusion !== '' && conclusion !== 'success' && conclusion !== 'neutral' && conclusion !== 'skipped';
}

function RunStatusIcon({ run }: { run: ReleaseWorkflowRun }) {
  if (run.status !== 'completed') {
    return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" aria-label="release in progress" />;
  }
  if (run.conclusion === 'success') {
    return <Check className="w-3.5 h-3.5 text-success shrink-0" aria-label="release succeeded" />;
  }
  return <X className="w-3.5 h-3.5 text-destructive shrink-0" aria-label="release failed" />;
}

export function ProjectReleasePanel({ projectKey }: { projectKey?: string }) {
  const { data } = useProjectReleaseStatusQuery(projectKey);
  if (!data || !data.available) return null;

  const latest = data.runs[0];
  const failedJobs = latest && latest.status === 'completed' && latest.conclusion !== 'success'
    ? data.latestRunJobs.filter(isJobFailed)
    : [];
  const succeededJobs = data.latestRunJobs.filter((job) => (job.conclusion ?? '').toLowerCase() === 'success');
  // Partial = the run failed but some jobs (e.g. the npm publish) succeeded —
  // the invisible v0.44.0 / v0.45.12 shape this panel exists to surface.
  const isPartial = failedJobs.length > 0 && succeededJobs.length > 0;

  return (
    <div className="bg-card border border-border rounded-sm px-3 py-2 mb-3" data-testid="project-release-panel">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Release</span>

        {latest ? (
          <>
            <RunStatusIcon run={latest} />
            <a
              href={latest.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-foreground hover:underline inline-flex items-center gap-1"
              title={latest.displayTitle}
            >
              {latest.tag}
              <ExternalLink className="w-3 h-3 text-muted-foreground" />
            </a>
            <span className="text-xs text-muted-foreground">
              {latest.status !== 'completed' ? 'running' : formatRelativeTime(latest.updatedAt)}
            </span>
            {isPartial && (
              <span className="text-xs text-destructive">
                partial failure —{' '}
                {failedJobs.map((job, index) => (
                  <span key={job.name}>
                    {index > 0 && ', '}
                    {job.htmlUrl ? (
                      <a href={job.htmlUrl} target="_blank" rel="noreferrer" className="underline">
                        {job.name}
                      </a>
                    ) : (
                      job.name
                    )}
                  </span>
                ))}
              </span>
            )}
            {!isPartial && failedJobs.length > 0 && (
              <span className="text-xs text-destructive">
                {failedJobs.length} job{failedJobs.length === 1 ? '' : 's'} failed
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">no release runs yet</span>
        )}

        {data.githubRelease && (
          <a
            href={data.githubRelease.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline inline-flex items-center gap-1"
          >
            GitHub Release <span className="font-mono">{data.githubRelease.tagName}</span>
          </a>
        )}

        {data.npmPackages.map((pkg) => (
          <a
            key={pkg.name}
            href={pkg.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline inline-flex items-center gap-1"
            title={pkg.error ? `registry unreachable: ${pkg.error}` : 'npm latest dist-tag'}
          >
            npm <span className="font-mono">{pkg.name}</span>
            <span className="font-mono text-foreground">{pkg.latestVersion ?? '—'}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
