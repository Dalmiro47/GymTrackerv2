## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c feat/routine-editor-replace-parity

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "feat(routines): add in-place exercise replace and dedup shared picker" 
git push -u origin feat/routine-editor-replace-parity

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D feat/routine-editor-replace-parity
 