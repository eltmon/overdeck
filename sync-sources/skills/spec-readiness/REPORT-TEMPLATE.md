# Spec Readiness — Report Template

This file defines the report structure for both HTML and EML formats. Only the report-generation subagent reads this.

## Branding

Configurable via wrapper `config.yaml`. Defaults:
- Primary Color: #1e293b (dark slate — headers, text)
- Stripe Color: matches primary (top accent bar)
- Score colors: Red (#E53935) < 8, Yellow (#FF9800) 8-14, Green (#43A047) 15+
- Status colors: Red = 0-39, Yellow = 40-69, Green = 70-100

If a wrapper `config.yaml` exists, use `branding.primary_color`, `branding.stripe_color`, `branding.company_name`, and `branding.footer_text` from it.

## Report Sections

### 1. Brand Stripe (4px)
Top-of-page accent bar using `branding.stripe_color` or default.

### 2. Header Block (primary_color background)
- Eyebrow text: "REQUIREMENTS READINESS ASSESSMENT" (uppercase, small, lighter accent)
- Title: "{Issue Title}" (white, large)
- Metadata line: "{Identifier} · {Project} · {Milestone/Release} · Assessed {date}" (light gray)
- Score badge: Large score number with status label and color (circular or pill badge)

### 3. Issue Info Row (Light Gray background, #F5F5F5)
Grid/flex row showing:
- Owner/Assignee
- Project
- Milestone/Release dates
- Child issue count (completed/total)
- Estimate if set

### 4. Score Dashboard — 5 metric cards in a row/grid
Each card contains:
- Dimension name (uppercase label, small text)
- Score as "X / 20" (large number)
- Visual bar (colored by score: red < 8, yellow 8-14, green 15+)
- One-line summary from dimension findings

### 5. Overall Score Bar
- Full-width progress bar showing 0-100
- Fill color matches status (red/yellow/green)
- Status label badge aligned right
- Score number displayed inside or above bar

### 6. Top Blockers (Amber/warning callout box)
- Background: light amber (#FFF8E1)
- Border-left: 4px solid #FF9800
- Header: "Top Blockers" with warning icon
- 3-5 actionable bullets
- Each with estimated point-improvement in parentheses

### 7. Dimension Details — One section per dimension
Each section contains:
- Section heading with dimension name and score badge (colored pill)
- Findings table with columns: Finding | Impact | Source | Recommendation
- Row colors: Green background tint for bonus findings, Red tint for deductions, Gray for neutral
- Impact column shows "+N" or "-N" with color

### 8. External Document Analysis (only if PRD/BRD found)
- Document source and access status
- Coverage summary
- Gaps identified
- Note if document was attached before or after development started

### 9. Child Issue Assessment Table
- Columns: ID (linked if possible), Title, Status, Has AC?, AC Quality, Notes
- AC Quality badges: Good (green pill), Weak (yellow pill), None (red pill)
- Summary row at bottom: "X of Y issues have testable acceptance criteria"
- Sortable appearance (styled headers)

### 10. Footer
- Light gray background
- Text: `branding.footer_text` or default: "Spec Readiness Assessment · Generated from {tracker} data · {Project}"
- Sub-text: "Methodology: 5-dimension scoring model"
- Assessment date

## HTML Format Guidelines

Use when generating `.html` output (default):

- Self-contained single HTML file (inline CSS, no external dependencies)
- Use `<style>` block in `<head>` for main styles
- Print-friendly: `@media print` rules for clean printing
- Table cells: `padding: 8px 12px; border-bottom: 1px solid #E0E0E0`
- Font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- Max width: 1000px, centered with `margin: 0 auto`
- Score badge CSS: `display: inline-block; padding: 4px 12px; border-radius: 12px; font-weight: 600`
- `open` command opens in browser

## EML Format Guidelines

Use when generating `.eml` output (`--eml` flag):

### MIME Headers

The file must start with RFC 2822 headers, then a blank line, then the HTML body:

```
MIME-Version: 1.0
Content-Type: text/html; charset="UTF-8"
Subject: Spec Readiness: {Identifier} — {Title} ({Score}/100 {StatusLabel})
From: noreply@example.com
To: noreply@example.com
Date: {RFC 2822 date, e.g. Thu, 27 Feb 2026 12:00:00 -0600}

<!DOCTYPE html>
<html>...
```

The `From` and `To` addresses are placeholders — the wrapper `config.yaml` can override them via `branding.eml_from` and `branding.eml_to`. Without a wrapper, use `noreply@example.com` as defaults. The user opens the `.eml` in their mail client and edits recipients before sending.

### Email-Safe HTML Constraints

- **All inline CSS** — no `<style>` blocks (many email clients strip them)
- **Table-based layout** using `<table role="presentation">` — no flexbox/grid
- **Max width: 560px** — email-friendly width
- **No external resources** — no linked stylesheets, fonts, or images
- Font stack: `Arial, 'Helvetica Neue', Helvetica, sans-serif`
- Use `&nbsp;` in empty cells, `&middot;` for separators
- `border-collapse: separate` on data tables for border-radius support

### Status Badge Inline Styles

```
Completed:   background-color:#E6F7F5; color:#00897B; padding:2px 8px; border-radius:10px; font-size:11px;
In-Progress: background-color:#DBEAFE; color:#1e40af; padding:2px 8px; border-radius:10px; font-size:11px;
Backlog:     background-color:#F5F5F5; color:#374151; border:1px solid #CFD1D1; padding:2px 8px; border-radius:10px; font-size:11px;
Blocked:     background-color:#FEE2E2; color:#DC2626; padding:2px 8px; border-radius:10px; font-size:11px;
```

### Score Badge Inline Styles

```
Red (0-39):    background-color:#FDECEA; color:#DC2626; padding:4px 12px; border-radius:12px; font-weight:600;
Yellow (40-69): background-color:#FFF8E1; color:#C2410C; padding:4px 12px; border-radius:12px; font-weight:600;
Green (70-100): background-color:#E6F7F5; color:#00897B; padding:4px 12px; border-radius:12px; font-weight:600;
```

### EML Branding Colors (defaults, overridable via wrapper)

- Primary Dark: `branding.primary_color` or `#1e293b` (headers, primary text)
- Body Text: `#374151` (labels, secondary text)
- Accent: `branding.stripe_color` or `#2563eb` (brand stripe, accents)
- Alert Red: `#DC2626`, Amber: `#D97706`, Green: `#00897B`

### Opening

`open` command opens `.eml` in the default mail client (Thunderbird, Mail.app, Outlook).

## JSON Sidecar

Always generated regardless of report format. Schema is defined in SCORING-REFERENCE.md.
Files save to the same output directory with naming convention:
- HTML: `spec-readiness-{identifier}.html`
- EML: `spec-readiness-{identifier}.eml`
- JSON: `spec-readiness-{identifier}.json`
