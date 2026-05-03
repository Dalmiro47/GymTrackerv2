# Brain Sync — Capture project state to Open Brain

Capture the current state of this project as a milestone thought in Open Brain MCP.

## Steps

1. Run these commands to gather context:
```
   git log --oneline -10
   git branch --show-current
   git diff --name-only HEAD~1 HEAD
```

2. Use the Open Brain MCP tool `capture_thought` with these exact parameters:
   - **content**: Concise summary of what was built/changed this session. Include: features shipped, key architecture decisions, files changed, open issues or next steps. Max 1800 characters.
   - **access_level**: `secret`
   - **type**: `meeting_debrief`
   - **source**: `claude_code`
   - **topics**: 3–5 relevant tags (e.g. `["Gym Tracker", "UI", "Playwright", "exercise-log"]`)
   - **action_items**: Open TODOs or next steps from this session

## Rules
- Never invent content — only capture what actually happened
- Keep content under 1800 characters, compress if needed
- Always include the branch name in content and at least 3 topics
- If nothing meaningful changed, skip the capture
- Anonymize full names in `secret` thoughts: "Christina Rodriguez" → "Christina R." — applies to `content`, `people`, and `action_items`