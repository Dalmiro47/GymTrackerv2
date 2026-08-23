## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c fix/coach-ai

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "fix: fixed coach ai not working" 
git push -u origin fix/coach-ai

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D fix/coach-ai
 