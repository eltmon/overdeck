# PAN-282: Replace native JS confirm/alert dialogs with styled Dialog components

## Issue Summary
Replace all `window.confirm()` and `window.alert()` calls in the dashboard frontend with styled dialog components that respect the existing Panopticon theming (light/dark mode).

## Approach
Created a React context-based dialog system with `useConfirm()` and `useAlert()` hooks that return async functions. Built `ConfirmDialog` and `AlertNoticeDialog` components using existing Tailwind CSS theming with proper accessibility (focus trap, keyboard handling, ARIA roles).

## Current Status
- [x] Create dialog system (provider, hooks, components)
- [x] Wire provider into App
- [x] Replace all confirm() calls
- [x] Replace all alert() calls
- [x] Verify build passes
- [x] Verify tests pass
- [ ] Commit and push

## Remaining Work
Commit and push.
