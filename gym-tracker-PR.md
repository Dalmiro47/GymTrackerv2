## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c chore/groq-model-migration

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "chore(ai): migrate deprecated Groq llama references to gpt-oss" 
git push -u origin chore/groq-model-migration

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D chore/groq-model-migration
 