## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c chore/fable5-code-review

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "chore(claude): Add REVIEW.md with full codebase review findings and prioritized improvement proposals." 
git push -u origin chore/fable5-code-review

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D chore/fable5-code-review
 