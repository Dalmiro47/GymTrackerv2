## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c ref/increase-overload

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "ref: refactor chat text box to make it Linkedin-style" 
git push -u origin ref/increase-overload

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D ref/increase-overload