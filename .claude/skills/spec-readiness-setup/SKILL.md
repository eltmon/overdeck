---
name: spec-readiness-setup
description: >
  Create a customized wrapper for the spec-readiness skill. Configures branding,
  issue tracker bindings, field mappings, and org-specific conventions. Generates
  a ready-to-use wrapper skill directory with config.yaml and SKILL.md.
triggers:
  - spec readiness setup
  - setup spec readiness
  - configure spec readiness
  - create readiness wrapper
  - customize readiness skill
  - spec readiness branding
  - brand readiness report
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# Spec Readiness Setup — Wrapper Creator

This skill creates a customized wrapper for the `spec-readiness` core skill. The wrapper binds your organization's branding, issue tracker, field names, and conventions to the generic scoring engine.

## What Gets Created

```
~/.panopticon/skills/spec-readiness-{name}/
  SKILL.md       # Wrapper skill that invokes the core with your config
  config.yaml    # Branding, tracker bindings, field mappings, conventions
```

After creation, the wrapper is immediately available. Users invoke it by name (e.g., `spec readiness acme MIN-704`) or the core skill auto-detects it.

---

## Workflow

### Step 1: Gather Information

Ask the user the following questions. Use `AskUserQuestion` with sensible defaults. Skip questions the user has already answered in their prompt.

**1. Wrapper name** (used in directory name and skill name):
- "What should this wrapper be called? This becomes the skill name, e.g., `spec-readiness-acme`"
- Default: derive from company name (lowercase, kebab-case)
- Validation: kebab-case, no spaces, alphanumeric + hyphens only

**2. Company / Organization name** (for report branding):
- "What company or team name should appear on reports?"
- This appears in the HTML report header and footer

**3. Issue tracker**:
- "Which issue tracker do you use?"
- Options: Linear, GitHub Issues, GitLab Issues, Rally, Jira, Other
- If Other: ask for details, we'll create a custom mapping

**4. Branding colors** (optional):
- "Do you have brand colors for the report? (Enter hex codes or skip for defaults)"
- Primary color (header/accents): default `#1e293b` (dark slate)
- Stripe color (top bar): default matches primary
- If the user has an existing branding skill, offer to read colors from it

**5. Tracker-specific fields** (based on tracker choice):

For **Linear**:
- "What's your team name in Linear?"
- "Do you use a label for customer-directed issues? (e.g., 'Customer Request')"

For **GitHub**:
- "What's the repo (owner/name)?"
- "Do you use labels for epics/features? (e.g., 'epic')"

For **GitLab**:
- "What's the project path?"
- "Do you use epics or parent issues for features?"

For **Rally**:
- "What's the MCP tool prefix for your Rally MCP server?"
- "Do you have a custom estimate field? (e.g., `c_ManDays`)"
- "Do you have an investment category field for customer-directed work?"

For **Jira**:
- "What's your Jira instance URL?"
- "Do you use Epics or another issue type for features?"
- "Custom estimate field name? (e.g., `story_points`, `customfield_10016`)"

**6. Org-specific conventions** (optional):
- "Do you use any naming patterns for overflow/carryover issues? (e.g., `[Unfinished]`, `[Part 2]`)"
- "Do you use any naming patterns for spike/investigation issues? (e.g., `SPIKE:`, `[Investigation]`)"
- "Any custom footer text for reports?"

### Step 2: Build Tracker Tool Mapping

Based on the tracker choice, generate the tool mapping. These are the MCP tools or CLI commands the core skill will use.

**Linear:**
```yaml
tracker:
  type: linear
  team: "{team_name}"
  tools:
    get_issue: "mcp__linear__get_issue"
    list_child_issues: "mcp__linear__list_issues"
    get_comments: "mcp__linear__list_comments"
    search_issues: "mcp__linear__list_issues"
    get_relations: "mcp__linear__get_issue"  # with includeRelations=true
    get_activity_log: null  # not available in Linear
  fields:
    identifier: "identifier"
    estimate: "estimate"
    status: "status"
    parent_field: "parentId"
    customer_directed_label: "{label_or_null}"
    overflow_markers: []
```

**GitHub:**
```yaml
tracker:
  type: github
  repo: "{owner}/{repo}"
  tools:
    get_issue: "bash:gh issue view {id} --repo {repo} --json title,body,state,labels,milestone,assignees,comments"
    list_child_issues: "bash:gh issue list --repo {repo} --search 'parent:{id}' --json number,title,body,state,createdAt"
    get_comments: "bash:gh issue view {id} --repo {repo} --json comments"
    search_issues: "bash:gh issue list --repo {repo} --label bug --search '{query}' --json number,title,state"
    get_relations: "bash:gh issue view {id} --repo {repo} --json body"  # parse from body
    get_activity_log: "bash:gh api repos/{repo}/issues/{id}/events"
  fields:
    identifier: "number"
    estimate: null  # GitHub has no native estimate field
    status: "state"
    parent_field: null  # GitHub uses tasklist / sub-issue references
    customer_directed_label: "{label_or_null}"
    overflow_markers: []
```

**GitLab:**
```yaml
tracker:
  type: gitlab
  project: "{project_path}"
  tools:
    get_issue: "bash:glab issue view {id}"
    list_child_issues: "bash:glab api '/projects/{project_id}/issues?parent_id={id}'"
    get_comments: "bash:glab issue note list {id}"
    search_issues: "bash:glab issue list --label bug --search '{query}'"
    get_relations: "bash:glab api '/projects/{project_id}/issues/{id}/links'"
    get_activity_log: "bash:glab api '/projects/{project_id}/issues/{id}/resource_state_events'"
  fields:
    identifier: "iid"
    estimate: "weight"
    status: "state"
    parent_field: "parent_id"
    customer_directed_label: "{label_or_null}"
    overflow_markers: []
```

**Rally:**
```yaml
tracker:
  type: rally
  tools:
    get_issue: "{mcp_prefix}__get_feature"
    get_story: "{mcp_prefix}__get_story"
    get_defect: "{mcp_prefix}__get_defect"
    list_child_issues: null  # from _collections.UserStories in feature response
    get_comments: null  # from Discussion collection
    search_issues: "{mcp_prefix}__search_work_items"
    get_relations: null  # from Predecessors/Successors collections
    get_activity_log: "{mcp_prefix}__get_revision_history"
    search_risks: "{mcp_prefix}__search_risks"
  fields:
    identifier: "FormattedID"
    estimate: "{custom_estimate_field_or_PlanEstimate}"
    status: "ScheduleState"
    parent_field: null  # Rally uses Feature→UserStory hierarchy
    customer_directed_label: null
    investment_category_field: "{field_or_null}"
    investment_category_value: "{value_or_null}"
    overflow_markers:
      - "[Unfinished]"
      - "[Continued]"
```

**Jira:**
```yaml
tracker:
  type: jira
  url: "{jira_url}"
  tools:
    get_issue: "bash:curl -s -H 'Authorization: Bearer $JIRA_TOKEN' '{jira_url}/rest/api/3/issue/{id}'"
    list_child_issues: "bash:curl -s -H 'Authorization: Bearer $JIRA_TOKEN' '{jira_url}/rest/api/2/search?jql=parent={id}'"
    get_comments: "bash:curl -s -H 'Authorization: Bearer $JIRA_TOKEN' '{jira_url}/rest/api/3/issue/{id}/comment'"
    search_issues: "bash:curl -s -H 'Authorization: Bearer $JIRA_TOKEN' '{jira_url}/rest/api/2/search?jql={jql}'"
    get_relations: "bash:curl -s -H 'Authorization: Bearer $JIRA_TOKEN' '{jira_url}/rest/api/3/issue/{id}?fields=issuelinks'"
    get_activity_log: "bash:curl -s -H 'Authorization: Bearer $JIRA_TOKEN' '{jira_url}/rest/api/3/issue/{id}/changelog'"
  fields:
    identifier: "key"
    estimate: "{custom_field_or_story_points}"
    status: "status.name"
    parent_field: "parent.key"
    customer_directed_label: "{label_or_null}"
    overflow_markers: []
```

### Step 3: Generate config.yaml

Assemble the full config from gathered information:

```yaml
# Spec Readiness Wrapper: {wrapper_name}
# Generated by spec-readiness-setup on {date}

tracker:
  type: {type}
  # ... tracker-specific fields from Step 2

branding:
  company_name: "{company_name}"
  primary_color: "{primary_color}"
  stripe_color: "{stripe_color}"
  footer_text: "{footer_text_or_null}"
  logo_url: null

conventions:
  overflow_markers: {markers_list}
  spike_patterns:
    - "spike"
    - "investigation"
    - "discovery"
    - "POC"
    - "prototype"
    - "analysis"
    # ... plus any user-specified patterns
  estimate_field_custom: "{custom_field_or_null}"
  investment_category_field: "{field_or_null}"
  investment_category_value: "{value_or_null}"
```

### Step 4: Generate Wrapper SKILL.md

Create the wrapper skill that invokes the core:

```markdown
---
name: spec-readiness-{name}
description: >
  {company_name}-branded requirements readiness scoring. Wraps the core
  spec-readiness skill with {company_name} branding and {tracker_type}
  tracker integration. Score issues 0-100 across 5 dimensions.
triggers:
  - spec readiness {name}
  - {name} readiness
  - {name} spec score
  # ... include all core triggers too
allowed-tools:
  - Read
  - Write
  - Bash
  - WebFetch
  - Task
  {tracker_specific_tools}
---

# Spec Readiness — {company_name}

This is a branded wrapper for the `spec-readiness` core skill.

## Configuration

- **Tracker:** {tracker_type}
- **Branding:** {company_name}
- **Config:** ~/.panopticon/skills/spec-readiness-{name}/config.yaml

## Usage

Invoke exactly like the core skill. This wrapper is auto-detected:

```
spec readiness {example_id}
how ready is {example_id}
readiness check {example_id}
```

## How It Works

1. This wrapper sets the configuration context (branding, tracker, field mappings)
2. The core `spec-readiness` skill runs the scoring engine
3. Reports are generated with {company_name} branding

**To modify configuration**, edit:
`~/.panopticon/skills/spec-readiness-{name}/config.yaml`

**To update the scoring model**, the core skill at
`~/.panopticon/skills/spec-readiness/SKILL.md` controls all scoring logic.
```

### Step 5: Write Files

```bash
mkdir -p ~/.panopticon/skills/spec-readiness-{name}
write config.yaml to ~/.panopticon/skills/spec-readiness-{name}/config.yaml
write SKILL.md to ~/.panopticon/skills/spec-readiness-{name}/SKILL.md
```

### Step 6: Verify and Report

1. Confirm both files were written
2. Show the user a summary:

```
Created spec-readiness wrapper: spec-readiness-{name}

  Location: ~/.panopticon/skills/spec-readiness-{name}/
  Tracker:  {tracker_type}
  Branding: {company_name} ({primary_color})

  Files:
    config.yaml  — tracker bindings, branding, conventions
    SKILL.md     — wrapper skill definition

  Usage:
    spec readiness {example_id}

  To customize further, edit:
    ~/.panopticon/skills/spec-readiness-{name}/config.yaml
```

3. Ask if they want to run a test assessment on a real issue to verify the setup

---

## Updating an Existing Wrapper

If the user runs this skill and a wrapper already exists:

1. Read the existing `config.yaml`
2. Show current configuration
3. Ask what they want to change
4. Update only the changed fields
5. Preserve any manual customizations

---

## Examples

```
User: setup spec readiness
→ Full wizard: asks all questions

User: create readiness wrapper for Acme using Linear
→ Skips tracker question, asks remaining

User: configure spec readiness for our team using GitHub Issues on eltmon/panopticon-cli
→ Skips tracker question and repo question

User: spec readiness branding — change colors to #0891b2
→ Updates existing wrapper branding only
```
