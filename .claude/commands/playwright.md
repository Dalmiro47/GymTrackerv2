# Playwright QA

Run Playwright tests for the current feature, creating the spec if it doesn't exist.

## Steps

1. Identify the current feature from the branch name:
   `git branch --show-current`

2. Check if a spec already exists for this specific feature:
   `find ./tests/playwright -name "[feature-name].spec.ts"`

3. If no spec exists for this feature, create one at
   `./tests/playwright/[feature-name].spec.ts` covering the main
   user flows changed in this session. Base it on recent git changes:
   `git diff --name-only HEAD~1 HEAD`

4. Run: `bash -c "npx playwright test --reporter=list 2>&1"`

5. If tests fail, fix the implementation (never the spec) and re-run

6. Loop until all tests pass

7. Report: spec created or existing, files changed, final test results

## Rules
- Never delete or weaken a test to make it pass
- Fix the implementation, not the spec
- Spec lives in /tests/playwright/ always