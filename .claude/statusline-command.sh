#!/usr/bin/env bash
# Claude Code status line: user | branch | model | cost | 5H | 7D

input=$(cat)

user=$(whoami)
branch=$(git -C "$(echo "$input" | jq -r '.workspace.current_dir // .cwd')" \
  --git-dir="$(echo "$input" | jq -r '.workspace.current_dir // .cwd')/.git" \
  rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
model=$(echo "$input" | jq -r '.model.display_name // empty')

# Token cost estimate (USD)
# Input: $3.00/M tokens, Output: $15.00/M tokens (Sonnet-class pricing)
total_in=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_out=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
cost=$(echo "$total_in $total_out" | awk '{printf "%.4f", ($1/1000000)*3.00 + ($2/1000000)*15.00}')

# Rate limits
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

# Build output parts
parts=()

parts+=("$(printf '\033[0;36m%s\033[0m' "$user")")

if [ -n "$branch" ]; then
  parts+=("$(printf '\033[0;33m%s\033[0m' "$branch")")
fi

if [ -n "$model" ]; then
  parts+=("$(printf '\033[0;35m%s\033[0m' "$model")")
fi

parts+=("$(printf '\033[0;32m$%s\033[0m' "$cost")")

if [ -n "$five_pct" ]; then
  parts+=("$(printf '\033[0;31m5H:%.0f%%\033[0m' "$five_pct")")
fi

if [ -n "$week_pct" ]; then
  parts+=("$(printf '\033[0;31m7D:%.0f%%\033[0m' "$week_pct")")
fi

# Join with separator
printf '%s' "${parts[0]}"
for part in "${parts[@]:1}"; do
  printf ' | %s' "$part"
done
printf '\n'
