## Claude Code YOLO
claude --dangerously-skip-permissions 

## Pull Request to Github 
git switch -c ref/chat-text-box3

## Do ALL THE CHANGES 

## Pull Request to Github 
git add -A 
git commit -m "ref: refactor chat text box to make it Linkedin-style" 
git push -u origin ref/chat-text-box3

## Make local main match GitHub

git switch main 
git fetch origin 
git reset --hard origin/main 
 

## Verify: 

git rev-parse HEAD 
git rev-parse origin/main 
 
## After merge, delete the branch
git branch -D ref/chat-text-box3