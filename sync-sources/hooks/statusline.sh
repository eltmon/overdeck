#!/usr/bin/env bash
# Claude Code status line — all available info + plan usage limits
# JSON is piped via stdin on each update

input=$(cat)

# Single jq call to extract all fields at once
eval "$(echo "$input" | jq -r '
  @sh "model=\(.model.display_name // "")",
  @sh "model_id=\(.model.id // "")",
  @sh "current_dir=\(.workspace.current_dir // "")",
  @sh "project_dir=\(.workspace.project_dir // "")",
  @sh "cost=\(.cost.total_cost_usd // 0)",
  @sh "lines_added=\(.cost.total_lines_added // 0)",
  @sh "lines_removed=\(.cost.total_lines_removed // 0)",
  @sh "ctx_used_pct=\(.context_window.used_percentage // 0)",
  @sh "ctx_size=\(.context_window.context_window_size // 0)",
  @sh "ctx_in=\(.context_window.current_usage.input_tokens // 0)",
  @sh "ctx_out=\(.context_window.current_usage.output_tokens // 0)"
' 2>/dev/null)"

# ANSI colors
RST='\033[0m'; DIM='\033[2m'
CYN='\033[36m'; GRN='\033[32m'; YLW='\033[33m'
MAG='\033[35m'; RED='\033[31m'; WHT='\033[37m'

# Helper: format token count
fmt() {
  local n=${1:-0}
  if (( n >= 1000000 )); then printf "%.1fM" "$(echo "scale=1;$n/1000000" | bc)"
  elif (( n >= 1000 )); then printf "%.1fk" "$(echo "scale=1;$n/1000" | bc)"
  else echo "$n"; fi
}

# Helper: color a percentage (green < 50, yellow < 80, red >= 80)
pct_color() {
  local pct_int=${1%.*}
  if (( ${pct_int:-0} >= 80 )); then echo "$RED"
  elif (( ${pct_int:-0} >= 50 )); then echo "$YLW"
  else echo "$GRN"; fi
}

# Helper: format time remaining from ISO timestamp
time_remaining() {
  local reset_at="$1"
  [ -z "$reset_at" ] || [ "$reset_at" = "null" ] && return
  local reset_epoch now_epoch diff_s hours mins
  reset_epoch=$(date -d "$reset_at" +%s 2>/dev/null) || return
  now_epoch=$(date +%s)
  diff_s=$(( reset_epoch - now_epoch ))
  (( diff_s <= 0 )) && { echo "now"; return; }
  hours=$(( diff_s / 3600 ))
  mins=$(( (diff_s % 3600) / 60 ))
  if (( hours > 0 )); then echo "${hours}h${mins}m"
  else echo "${mins}m"; fi
}

# --- Usage limits (cached for 60s) ---
CACHE_FILE="/tmp/.claude-usage-cache-$(id -u)"
CACHE_TTL=60
usage_5h="" usage_7d="" reset_5h="" reset_7d=""

fetch_usage() {
  local creds_file="$HOME/.claude/.credentials.json"
  [ -f "$creds_file" ] || return
  local token
  token=$(jq -r '.claudeAiOauth.accessToken // empty' "$creds_file" 2>/dev/null)
  [ -z "$token" ] && return
  local response
  response=$(curl -sf --max-time 3 \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -H "anthropic-beta: oauth-2025-04-20" \
    "https://api.anthropic.com/api/oauth/usage" 2>/dev/null) || return
  echo "$response" > "$CACHE_FILE"
}

# Use cache if fresh, otherwise fetch in background
if [ -f "$CACHE_FILE" ]; then
  cache_age=$(( $(date +%s) - $(stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if (( cache_age > CACHE_TTL )); then
    # Fetch in background so we don't block the statusline
    fetch_usage &
  fi
else
  # First run — fetch synchronously (one-time cost)
  fetch_usage
fi

# Read cached data
if [ -f "$CACHE_FILE" ]; then
  eval "$(jq -r '
    @sh "usage_5h=\(.five_hour.utilization // "")",
    @sh "reset_5h=\(.five_hour.resets_at // "")",
    @sh "usage_7d=\(.seven_day.utilization // "")",
    @sh "reset_7d=\(.seven_day.resets_at // "")"
  ' "$CACHE_FILE" 2>/dev/null)"
fi

# Git branch (fast — reads file directly, no subprocess)
git_branch=""
dir="${current_dir:-.}"
while [ "$dir" != "/" ]; do
  if [ -f "$dir/.git/HEAD" ]; then
    ref=$(< "$dir/.git/HEAD")
    git_branch="${ref#ref: refs/heads/}"
    break
  fi
  dir=$(dirname "$dir")
done

# Context % color
ctx_color=$(pct_color "$ctx_used_pct")

# Cost formatting
cost_fmt=$(printf '$%.4f' "${cost:-0}")

# Line 1: model | dir | git branch
line1=""
[ -n "$model" ] && line1+=$(printf "%b%s%b" "$MAG" "$model" "$RST")
[ -n "$model_id" ] && line1+=$(printf " %b(%s)%b" "$DIM" "$model_id" "$RST")
if [ -n "$current_dir" ]; then
  short_dir="${current_dir/#$HOME/~}"
  line1+=$(printf "  %b%s%b" "$CYN" "$short_dir" "$RST")
fi
[ -n "$git_branch" ] && line1+=$(printf "  %b%b%s%b" "$DIM" "$GRN" "$git_branch" "$RST")

# Line 2: context usage | cost | lines changed
line2=""
line2+=$(printf "%bctx%b %b%.0f%%%b" "$DIM" "$RST" "$ctx_color" "$ctx_used_pct" "$RST")
line2+=$(printf "  %b%s%b/%b%s%b" "$WHT" "$(fmt "$ctx_in")" "$RST" "$DIM" "$(fmt "$ctx_size")" "$RST")
line2+=$(printf "  %bout%b %s" "$DIM" "$RST" "$(fmt "$ctx_out")")
line2+=$(printf "  %bcost%b %b%s%b" "$DIM" "$RST" "$YLW" "$cost_fmt" "$RST")
if (( lines_added > 0 || lines_removed > 0 )); then
  line2+=$(printf "  %b+%d%b/%b-%d%b" "$GRN" "$lines_added" "$RST" "$RED" "$lines_removed" "$RST")
fi

# Line 3: plan usage limits (5h + 7d)
line3=""
if [ -n "$usage_5h" ]; then
  u5_color=$(pct_color "$usage_5h")
  u5_reset=$(time_remaining "$reset_5h")
  line3+=$(printf "%b5h%b %b%.0f%%%b" "$DIM" "$RST" "$u5_color" "$usage_5h" "$RST")
  [ -n "$u5_reset" ] && line3+=$(printf " %b(%s)%b" "$DIM" "$u5_reset" "$RST")
fi
if [ -n "$usage_7d" ]; then
  u7_color=$(pct_color "$usage_7d")
  u7_reset=$(time_remaining "$reset_7d")
  [ -n "$line3" ] && line3+="  "
  line3+=$(printf "%b7d%b %b%.0f%%%b" "$DIM" "$RST" "$u7_color" "$usage_7d" "$RST")
  [ -n "$u7_reset" ] && line3+=$(printf " %b(%s)%b" "$DIM" "$u7_reset" "$RST")
fi

# Write context % to agent dir for dashboard monitoring (non-blocking)
if [ -n "$PANOPTICON_AGENT_ID" ] && [ -n "$ctx_used_pct" ]; then
  CTX_DIR="$HOME/.panopticon/agents/$PANOPTICON_AGENT_ID"
  if [ -d "$CTX_DIR" ]; then
    printf '%.0f' "$ctx_used_pct" > "$CTX_DIR/context-pct" 2>/dev/null || true
    # Capture initial context % (first time only)
    if [ ! -f "$CTX_DIR/initial-context-pct" ]; then
      printf '%.0f' "$ctx_used_pct" > "$CTX_DIR/initial-context-pct" 2>/dev/null || true
    fi
  fi
fi

printf "%b\n" "$line1"
printf "%b\n" "$line2"
[ -n "$line3" ] && printf "%b\n" "$line3"
