import { SkillOverridesPanel } from './skills/SkillOverridesPanel';

/** The Skills page: every skill with its global default (PAN-3942). */
export function SkillsList() {
  return (
    <div className="space-y-4">
      <div>
        <div className="eyebrow">Skills</div>
        <h2 className="text-lg font-medium text-foreground">Global defaults</h2>
      </div>
      <SkillOverridesPanel level="global" />
    </div>
  );
}
