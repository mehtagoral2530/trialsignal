#!/usr/bin/env bash
# One-time publish: pushes this folder as a fresh `main` branch of your GitHub repo.
# Your existing branches are left untouched. Usage (from the folder you unzipped):
#   bash trialsignal/publish.sh                      # uses github.com/mehtagoral2530/trialsignal
#   bash trialsignal/publish.sh https://github.com/<you>/<repo>.git
set -euo pipefail
REPO_URL="${1:-https://github.com/mehtagoral2530/trialsignal.git}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v git >/dev/null || { echo "git is not installed. Install it from https://git-scm.com and run this again."; exit 1; }

if git ls-remote --exit-code --heads "$REPO_URL" main >/dev/null 2>&1; then
  echo "This repo already has a 'main' branch, so nothing was pushed (to avoid overwriting it)."
  echo "Rename or delete that branch on GitHub first, or ask for the merge steps."
  exit 1
fi

WORK="$(mktemp -d)"
cp -R "$SRC"/. "$WORK"/
cd "$WORK"
rm -rf .git
git init -q -b main
git config user.name  >/dev/null || git config user.name  "mehtagoral2530"
git config user.email >/dev/null || git config user.email "mehtagoral2530@users.noreply.github.com"
git add -A
# [skip ci]: don't run workflows on this first push; Pages isn't switched on yet.
git commit -qm "TrialSignal: plain-English trial explainer on GitHub Pages [skip ci]"
git remote add origin "$REPO_URL"
echo "Pushing to $REPO_URL (GitHub may ask you to sign in)..."
git push -u origin main

cat <<'NEXT'

Done. Three clicks left on github.com, in your repo:
  1. Settings → General → Default branch → switch to "main".
  2. Settings → Pages → Build and deployment → Source: "GitHub Actions".
  3. Actions → "Deploy site to GitHub Pages" → Run workflow.
Your site will be at https://<your-username>.github.io/<repo>/ in about a minute.
NEXT
