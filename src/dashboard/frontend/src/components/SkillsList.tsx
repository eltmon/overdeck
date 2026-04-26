import { useState, useEffect } from 'react';
import { BookOpen, Folder, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { Skill } from '../types';

export function SkillsList() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/skills');
      if (!response.ok) throw new Error('Failed to fetch skills');
      const data = await response.json();
      setSkills(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="badge-bg-destructive border badge-border-destructive rounded-lg p-4 text-destructive">
        <AlertCircle className="w-5 h-5 inline mr-2" />
        {error}
      </div>
    );
  }

  // Group skills by source
  const panopticonSkills = skills.filter((s) => s.source === 'panopticon');
  const claudeSkills = skills.filter((s) => s.source === 'claude');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Skills</h2>
        <button
          onClick={fetchSkills}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-popover rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {skills.length === 0 ? (
        <div className="bg-card rounded-lg p-8 text-center text-muted-foreground">
          <Folder className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No skills found</p>
          <p className="text-sm mt-2">
            Add skills to ~/.panopticon/skills/ or ~/.claude/skills/
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Panopticon Skills */}
          <div className="bg-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <h3 className="font-medium text-foreground">
                Panopticon ({panopticonSkills.length})
              </h3>
            </div>
            <div className="space-y-2">
              {panopticonSkills.map((skill) => (
                <SkillCard key={skill.path} skill={skill} />
              ))}
              {panopticonSkills.length === 0 && (
                <p className="text-muted-foreground text-sm">No Panopticon skills</p>
              )}
            </div>
          </div>

          {/* Claude Skills */}
          <div className="bg-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-signal-review" />
              <h3 className="font-medium text-foreground">
                Claude ({claudeSkills.length})
              </h3>
            </div>
            <div className="space-y-2">
              {claudeSkills.map((skill) => (
                <SkillCard key={skill.path} skill={skill} />
              ))}
              {claudeSkills.length === 0 && (
                <p className="text-muted-foreground text-sm">No Claude skills</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-card rounded-lg p-4">
        <h3 className="font-medium text-foreground mb-2">Skill Locations</h3>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>
            <span className="text-primary">Panopticon:</span>{' '}
            ~/.panopticon/skills/
          </p>
          <p>
            <span className="text-signal-review">Claude:</span> ~/.claude/skills/
          </p>
        </div>
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: Skill }) {
  return (
    <div className="bg-popover/50 rounded-lg p-3 hover:bg-popover transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{skill.name}</span>
        </div>
        {skill.hasSkillMd ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="w-3 h-3" />
            SKILL.md
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-warning">
            <AlertCircle className="w-3 h-3" />
            No SKILL.md
          </span>
        )}
      </div>
      {skill.description && (
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
          {skill.description}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground truncate">{skill.path}</p>
    </div>
  );
}
