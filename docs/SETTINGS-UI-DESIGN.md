# Settings UI Design (Stitch)

**Project**: Panopticon Settings Page Redesign
**Stitch Project ID**: `8973105193959682086`
**Status**: ✅ Designs Complete
**Date**: 2026-01-26

---

## Overview

Professional Stitch mockups created for the Settings page redesign (PAN-118). Two design states generated:
1. **Collapsed state** - Default view with overrides section collapsed
2. **Expanded state** - Full table showing all 23 work types

---

## Design 1: Collapsed State

**Screen ID**: `7fa42f79326c47e1a96c4920172405c7`
**Dimensions**: 2560x2818 (Desktop)

### Sections

1. **Header**
   - Title: "System Settings" with gear icon
   - Subtitle: Configuration description
   - Actions: "Save Changes" button + "Reset to Defaults" link

2. **Model Presets** (3 cards)
   - **Premium**: Gold accent, crown icon, 5/5 cost meter
   - **Balanced**: Blue accent (selected), scales icon, 3/5 cost meter
   - **Budget**: Green accent, dollar icon, 1/5 cost meter

3. **Provider Management** (2x2 grid)
   - **Anthropic**: Connected, locked toggle, 12 models
   - **OpenAI**: Not configured, API key input + Test Connection
   - **Google**: Connected, Gemini Thinking slider (4 levels)
   - **Z.AI**: Not configured, same as OpenAI

4. **Advanced Overrides**: Collapsed (chevron down)

---

## Design 2: Expanded State

**Screen ID**: `3ecc5eb1c0cf4472bb6d58eede63c7ff`
**Dimensions**: 2560x4470 (Desktop)

Same as Design 1, plus fully expanded overrides table:

### Work Types Table (23 rows)

Categories:
- Issue Agent Phases (6)
- Specialist Agents (3)
- Convoy Members (4)
- Subagents (4)
- Pre-Work Agents (4)
- CLI Contexts (2)

Features:
- Blue "preset" badges (default from preset)
- Orange "override" badges (2 active custom overrides)
- ⚙️ icon to configure, ✕ icon to remove
- Footer: Reset button + "2 overrides active"

---

## Component Structure

30+ components planned for extraction:

### Core Layout
- SettingsPage, SettingsSection, PageHeader

### Presets (5 components)
- PresetSelector, PresetCard, CostIndicator, etc.

### Providers (8 components)
- ProviderPanel, ProviderCard, ApiKeyInput, TestConnectionButton, ThinkingLevelSlider, etc.

### Overrides (6 components)
- WorkTypeOverrides, WorkTypeTable, CategoryHeader, WorkTypeRow, ModelBadge, etc.

### Shared (6 components)
- Button, Badge, Icon, StatusDot, Toggle, etc.

---

## Visual Theme

- **Background**: #1a1b26 (dark blue-gray)
- **Cards**: #24283b (lighter dark)
- **Text**: White headings, #a9b1d6 body
- **Accents**: Blue #7aa2f7, Gold #e0af68, Green #9ece6a
- **Typography**: Inter font, 8px corners, 24px spacing

---

## API Integration

Connects to existing endpoints:
- `GET /api/settings` - Fetch config
- `PUT /api/settings` - Save config
- `POST /api/settings/validate-api-key` - Validate keys
- `GET /api/settings/available-models` - Get models

---

## Next Steps

1. **PAN-118-17**: Generate React components from designs
2. **PAN-118-18**: Integrate with Settings API
3. **PAN-118-19**: Polish (animations, error handling)

---

**Design Quality**: ✅ Professional, dark mode, responsive, accessible
**Ready for**: Component generation and implementation
