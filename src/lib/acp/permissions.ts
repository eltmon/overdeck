import type * as EffectAcpSchema from "effect-acp/schema";

type PermissionOption =
  EffectAcpSchema.RequestPermissionRequest["options"][number];
type SelectedPermissionOutcome = Extract<
  EffectAcpSchema.RequestPermissionResponse["outcome"],
  { outcome: "selected" }
>;

type PermissionCategory = "allow_always" | "allow_once" | "reject";

const SESSION_ALLOW_PATTERN =
  /(?:allow|accept|approve|permit).*(?:always|session)|(?:always|session).*(?:allow|accept|approve|permit)/;
const SINGLE_ALLOW_PATTERN =
  /(?:^|[^a-z])(?:allow|accept|approve|permit)(?:[^a-z]|$)/;
const REJECT_PATTERN =
  /(?:^|[^a-z])(?:reject|decline|deny|refuse|cancel)(?:[^a-z]|$)/;

function heuristicCategory(option: PermissionOption): PermissionCategory | null {
  if (option.kind !== undefined) return null;

  const text = `${option.name} ${option.optionId}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (SESSION_ALLOW_PATTERN.test(text)) return "allow_always";
  if (REJECT_PATTERN.test(text)) return "reject";
  if (SINGLE_ALLOW_PATTERN.test(text)) return "allow_once";
  return null;
}

function optionCategory(option: PermissionOption): PermissionCategory | null {
  switch (option.kind) {
    case "allow_always":
      return "allow_always";
    case "allow_once":
      return "allow_once";
    case "reject_once":
    case "reject_always":
      return "reject";
    default:
      return heuristicCategory(option);
  }
}

export function selectAutoPermissionOutcome(
  params: EffectAcpSchema.RequestPermissionRequest,
): SelectedPermissionOutcome | null {
  const categorized = params.options.map((option) => ({
    option,
    category: optionCategory(option),
  }));
  const selected =
    categorized.find(({ category }) => category === "allow_always")?.option ??
    categorized.find(({ category }) => category === "allow_once")?.option ??
    categorized.find(({ category }) => category === "reject")?.option;

  return selected
    ? { outcome: "selected", optionId: selected.optionId }
    : null;
}

export function isRejectPermissionOption(option: PermissionOption): boolean {
  return optionCategory(option) === "reject";
}
