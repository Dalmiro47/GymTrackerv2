## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c fix/feedback

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "fix: feedback from user" 
git push -u origin fix/feedback

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D fix/feedback


## To kill ports in use: 
taskkill /PID 20704 /F