plan-digest: 62b446951bd65dc3f25d519b6a6e7343e276260e72ee5fe9620a19370fe06059

## blocks-the-design: Enter can answer a visible permission menu

`src/lib/terminal-backends/herdr-submit.ts:79-97` checks `paneHasBlockingChoiceMenu` before the first `pane.send_keys` only when composer presence is **not** `present`. The existing test at `tests/unit/lib/terminal-backends/herdr-submit.test.ts:119-133` supplies a screen with the payload in the composer and a permission menu below it, then explicitly expects one Enter. Once this plan makes the screen readable, that Enter can approve the menu. W3 (`.pan/drafts/PAN-5232.md:302-306`) requires the existing expectation to remain unchanged, so it preserves the unsafe behavior. Change W3 to check the latest screen for a blocking menu and the agent's blocked state before the first submit key, regardless of composer presence. Change that test to require zero `pane.send_keys` calls and a blocked outcome.

## blocks-the-design: Resume treats permission menus as clear

`src/lib/agents/resume-pane-choice.ts:82-88` calls `paneChoiceFromText(screen)` and returns `{ready:true, action:'clear'}` on null. `src/lib/session-pane-choice.ts:63-65` uses the card parser, which excludes three-option permission menus at `src/lib/pane-choice-menu.ts:210-215`. The existing fixture at `tests/lib/pane-choice-menu.test.ts:196-207` proves that such a menu is null in card mode but true under the existing `paneHasBlockingChoiceMenu` guard. Thus the PRD's claim at `.pan/drafts/PAN-5232.md:124` that “other menus return `ready:false`” is false: a continuation can still be sent into a visible permission menu. Add a guard-mode check before the Herdr resume path returns `clear`, and require `ready:false` for a permission-menu fixture in `resume-pane-choice.test.ts`.

## sharpens-framing: Resume capture uses recent, not visible

`src/lib/agents/resume-pane-choice.ts:42` calls `readHerdrPaneText` without a source, so `src/lib/terminal-backends/herdr.ts:521` sends `source:'recent'`. `docs/TERMINAL-BACKENDS.md:607-609` says `recent` is empty for full-screen TUIs on the alternate screen, while `visible` includes that screen. The converted mock at `src/lib/agents/__tests__/resume-pane-choice.test.ts:130-153` does not inspect `source`, so it cannot establish the plan's resume-menu claim for such panes. Have the Herdr resume capture request `visible` and assert that request in the test.
