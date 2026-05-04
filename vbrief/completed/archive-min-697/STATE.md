# STATE.md - MIN-697

## Issue
Reduce background image blur/opacity behind briefing and upcoming events

## Current Status
**COMPLETE** - All changes committed and pushed

## Decisions Made

1. **Image opacity**: `0.03` → `0.12` (4x more visible)
2. **Light overlay**: `white/95, /93, /96` → `white/85, /80, /87`
3. **Dark overlay**: `slate-900/72, /68, /74` → `slate-900/60, /55, /62`
4. **Blur**: `backdrop-blur-[3px]` → `backdrop-blur-[1px]`
5. **Text shadow on photographer attribution**: Add `textShadow` to keep attribution readable

## Files Changed

- `fe/src/components/home/Home.jsx` — lines 64 and 284

## Remaining Work

None — implementation complete.
