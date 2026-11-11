/**
 * PAN-5153: read-only Settings section naming who acts on each registered
 * project's GitHub repository (the App's bot, the gh account, or nobody).
 */
import { useGitHubIdentities } from '../../CommandDeck/ProjectTree/useGitHubIdentities';

export function GitHubIdentitiesSection() {
  const { data, isError } = useGitHubIdentities();

  return (
    <section id="github-identities" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
        GitHub Identities
      </h2>
      {isError && <p className="text-xs text-destructive mb-3">Could not load GitHub identities.</p>}
      {data && (
        <>
          <div className="space-y-1 mb-3 text-xs text-muted-foreground">
            <p>gh account: <span className="font-mono text-foreground">{data.ghLogin ?? 'not signed in'}</span></p>
            <p>GitHub App: <span className="font-mono text-foreground">{data.appSlug ?? 'not configured'}</span></p>
          </div>
          {data.owners.length === 0 ? (
            <p className="text-xs text-muted-foreground">No registered project has a GitHub repository.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-medium">Owner</th>
                  <th className="py-1.5 pr-3 font-medium">Project</th>
                  <th className="py-1.5 pr-3 font-medium">Repository</th>
                  <th className="py-1.5 pr-3 font-medium">Acts as</th>
                  <th className="py-1.5 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {data.owners.flatMap(({ owner, projects }) => projects.map((project, index) => (
                  <tr key={project.key} data-testid={`github-identity-row-${project.key}`} className="border-b border-border">
                    <td className="py-1.5 pr-3 font-mono text-foreground">{index === 0 ? owner : ''}</td>
                    <td className="py-1.5 pr-3 text-foreground">{project.name}</td>
                    <td className="py-1.5 pr-3 font-mono text-muted-foreground">{project.repo}</td>
                    <td className={`py-1.5 pr-3 font-mono ${project.mode === 'none' ? 'text-destructive' : 'text-foreground'}`}>
                      {project.actor ?? 'not signed in'}
                    </td>
                    <td className="py-1.5 text-muted-foreground">{project.detail}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground mt-3">
        Overdeck acts as the GitHub App&apos;s bot on repositories where the App is installed, and as your gh account
        everywhere else. To use the bot in an organization, make the App public in its GitHub settings and install it
        on the organization. Run pan doctor to re-check.
      </p>
    </section>
  );
}
