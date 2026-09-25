## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c ref/overload-daily-goal

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "ref: pr reset" 
git push -u origin ref/overload-daily-goal

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D ref/overload-daily-goal


## To kill ports in use: 
taskkill /PID 20704 /F