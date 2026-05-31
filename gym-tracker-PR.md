## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c chore/brain-sync-readme-audit

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "chore(claude): add Step 0b README drift audit to brain-sync" 
git push -u origin chore/brain-sync-readme-audit

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D chore/brain-sync-readme-audit
 