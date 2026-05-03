## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c feat/constrain-md

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "feat: add constrain.md logic to better agentic flow" 
git push -u origin feat/constrain-md

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D feat/constrain-md
 