plan-digest: 4b7f6b3ee364c7654dbfc9c8383d4702c53c896aa2596dc63fb72dabda8bfdd2

## sharpens-framing: Relative-time rule conflicts with this spec

The PRD's WI-2 says fixture timestamps rendered as relative time must always come from `Date.now()`, while D-6 and the xBRIEF explicitly leave `CONVERSATIONS` fixed. In `/home/eltmon/Projects/overdeck/workspaces/feature-pan-4757/src/dashboard/frontend/tests/pan-2355-mobile.spec.ts`, lines 53–55 set fixed `lastActivityAt` values; lines 121 and 153–156 display those rows. `/home/eltmon/Projects/overdeck/workspaces/feature-pan-4757/src/dashboard/frontend/src/components/mobile/MobileConversations.tsx`, lines 18–20 and 50–55 render `lastActivityAt` with `formatRelativeTime`. The proposed rule would declare this same spec noncompliant as soon as it is added. Narrow the rule to relative labels used by a locator or assertion, or make the conversation fixture relative too and revise D-6 and the non-goal.

## sharpens-framing: The collision guard is not asserted

FR-2 and AC-2 promise that the ship header renders `yesterday` on every run, making this a permanent regression guard. The xBRIEF only changes the fixture and the `Yes` locator. In `/home/eltmon/Projects/overdeck/workspaces/feature-pan-4757/src/dashboard/frontend/tests/pan-2355-mobile.spec.ts`, lines 127–138 check expansion, tap targets, the option, and the post; none checks the header text. The spec would still pass if the header stopped showing `yesterday`, so a green Playwright result does not prove AC-2's collision condition. Add an assertion scoped to the ship row's header for `yesterday` before the `Yes` tap.

## footnote: Strict-mode glossary overstates assertions

The PRD glossary says every `expect(locator)` assertion requires exactly one element. The spec itself uses `await expect(first).toHaveCount(0)` at `/home/eltmon/Projects/overdeck/workspaces/feature-pan-4757/src/dashboard/frontend/tests/pan-2355-mobile.spec.ts`, line 138; count assertions intentionally accept zero or multiple elements. Limit the glossary statement to actions and assertions that require a single element.
