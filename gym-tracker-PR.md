## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c ref/ui-redesign

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "ref(claude): Refactor UI with unified design token system, consistent accent color, and per-page layout cleanup across all views." 
git push -u origin ref/ui-redesign

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D ref/ui-redesign
 