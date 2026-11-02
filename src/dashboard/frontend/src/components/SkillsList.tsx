import { SkillOverridesPanel } from './skills/SkillOverridesPanel';

/** The Skills page: every skill with its global default (PAN-3942). */
export function SkillsList() {
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-3">
      <h1 className="display-lg text-foreground">Skills</h1>
      <SkillOverridesPanel level="global" />
    </div>
  );
}
