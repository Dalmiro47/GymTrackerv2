## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c ref/pr-reset

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "ref: pr reset" 
git push -u origin ref/pr-reset

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D ref/pr-reset


## To kill ports in use: 
taskkill /PID 20704 /F