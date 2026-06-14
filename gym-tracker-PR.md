## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c feat/progression-detector

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "feat(dashboard): add per-exercise e1RM stall detector with progression status section" 
git push -u origin feat/progression-detector

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D feat/progression-detector
 