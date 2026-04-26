/**
 * Smart Selection Explainer
 *
 * Explains the opinionated model selection philosophy:
 * - Always pick the best model for each task
 * - Users control cost by which providers they enable
 */

export function SmartSelectionExplainer() {
  return (
    <section className="mb-12">
      <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[#a078f7]">auto_awesome</span>
        Smart Model Selection
      </h2>
      <p className="text-muted-foreground mb-6">
        The system automatically picks the best model for each task based on capability scores.
      </p>

      <div className="bg-card rounded-xl p-6 border border-border shadow-sm">
        {/* Philosophy */}
        <div className="flex items-start gap-3 mb-6">
          <span className="material-symbols-outlined text-[#a078f7] text-2xl">psychology</span>
          <div>
            <h3 className="font-semibold mb-2">Opinionated Selection</h3>
            <p className="text-sm text-muted-foreground">
              We believe in using the <strong>right model for the right job</strong>. The system
              evaluates each task's requirements and picks the model with the best capability
              scores for that specific task type.
            </p>
          </div>
        </div>

        {/* How it works */}
        <div className="flex items-start gap-3 mb-6">
          <span className="material-symbols-outlined text-[#a078f7] text-2xl">tune</span>
          <div>
            <h3 className="font-semibold mb-2">You Control Cost</h3>
            <p className="text-sm text-muted-foreground">
              Control your costs by choosing which providers to enable below. If you only enable
              Anthropic, you'll use Claude models. Enable additional providers to unlock their
              models for tasks where they excel.
            </p>
          </div>
        </div>

        {/* Examples */}
        <div className="border-t border-border pt-4 mt-4">
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-muted-foreground">lightbulb</span>
            Smart Selection Examples
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-warning text-base">architecture</span>
                <span className="font-medium">Planning & Architecture</span>
              </div>
              <p className="text-muted-foreground">Claude Opus 4.6 - Best for complex reasoning</p>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-primary text-base">code</span>
                <span className="font-medium">Code Generation</span>
              </div>
              <p className="text-muted-foreground">Kimi K2.5 or Claude Sonnet - Excellent coding capability</p>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-success text-base">speed</span>
                <span className="font-medium">Quick Commands</span>
              </div>
              <p className="text-muted-foreground">Fast models prioritized for responsive interaction</p>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-destructive text-base">security</span>
                <span className="font-medium">Security Review</span>
              </div>
              <p className="text-muted-foreground">Premium models only - security is non-negotiable</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
