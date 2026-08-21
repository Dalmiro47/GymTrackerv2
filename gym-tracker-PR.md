## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c ref/reps-goal1

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "ref: add a ui improvement to show when I hit the rep goal and I should do an increase overload" 
git push -u origin ref/reps-goal1

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D ref/reps-goal1
 