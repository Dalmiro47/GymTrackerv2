## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c chore/brain-sync-skill-maintenance-gate

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "chore(brain-sync): add Step 0c skill maintenance gate (create/update/delete, propose-only)" 
git push -u origin chore/brain-sync-skill-maintenance-gate

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D chore/brain-sync-skill-maintenance-gate
 