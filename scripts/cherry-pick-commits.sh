#!/bin/bash
# Automated upstream sync script for LinkX
# This script cherry-picks custom commits with auto-conflict resolution

set -e  # Exit on error

echo "🚀 Starting automated upstream sync..."
echo ""

# Array of custom LinkX commits in chronological order (oldest to newest)
COMMITS=(
  "8c4a92c"  # chore: added agents.md and refactored primary color
  "018da93"  # feat: added schdule post date time picker with natural language
  "29c5f94"  # feat: added postInputBox component
  "492fb05"  # feat: added new route timeline
  "b02e4d8"  # feat: added profile component in the sidebar
  "429437d"  # feat: added brand assets
  "638453f"  # refactor: added .af in gitignore
  "6eb73b4"  # feat: added brandkit
  "5f2b805"  # feat: added profile settings and preferences in profile dropdown in the sidebar
  "58d5743"  # docs: added docs for social media integration
  "23f8d16"  # refactor: cleaned up the timeline and sidebard layout
  "dc0d7f9"  # feat: added posts page with filters and stats
  "1cd28a9"  # refactor: fixed errors from frontend docker build
  "9803e99"  # docs: added x implementation and setup specs
  "d5af712"  # feat: add post components and platform selector
  "13d5532"  # feat: add linkedin and x post previews
  "e893e0e"  # feat: add post actions to timeline and posts
  "83d5c0d"  # feat: add relative dates to posts (2h ago, In 4 days)
  "5319a3a"  # feat: replace WhoToFollow with TimelineFilters component
  "49994c3"  # refactor: update timeline data dates to reflect logical timeline order
  "193254d"  # fix: remove unused imports and add navigation separator line
  "dd0dd5a"  # feat: add posts table migration
  "388ff6f"  # feat(backend): add posts API with CRUD operations
  "5579e63"  # refactor(frontend): remove mock data files
  "94356ba"  # feat(frontend): add post data transformation utilities
  "0b784f9"  # feat(frontend): integrate posts page with backend API
  "95a907d"  # feat(frontend): add create post dialog with API integration
  "4c23991"  # feat(frontend): add create post dialog to sidebar
  "ac17a6a"  # refactor(frontend): restructure home route with timeline and AI tabs
  "5618f8a"  # chore(frontend): regenerate API client and route tree
  "bf9886d"  # refactor: reorganize sidebar and routes
  "1bc2b34"  # feat(frontend): extract post form logic and create action bar component
  "97e478d"  # refactor(frontend): redesign PostInputBox with responsive layout improvements
  "ea15b60"  # chore(ci): disable GitHub Actions auto triggers
  "39bc010"  # feat(frontend): update posts, timeline, and AI routes
  "b51d165"  # docs: document LinkedIn social integration
  "4c71ad5"  # docs: clarify LinkX as self-hosted OSS
  "92f17d5"  # fix(ui): single page scroll on right, thin scrollbar styling
  "f737314"  # feat: add new profile page with consistent spacing and edit mode
  "0295b35"  # feat: remove AI tabs from home page and add chat route
  "51f392c"  # feat: make PostInputBox sticky on home page
  "f6055c3"  # fix: change default platform from 'all' to 'linkedin'
  "983000f"  # chore: add @radix-ui/react-switch dependency
  "540aabd"  # feat: add LinkedIn integration backend and social accounts page
  "ca6f9f0"  # refactor: remove duplicate AI route and fix profile header
  "71687f3"  # Feat/linkedin integration (#18)
  "7475e1c"  # security: pin pnpm to specific version instead of latest
)

# Files that should always use OUR changes (custom LinkX code)
OUR_FILES=(
  "backend/app/api/routes/linkedin.py"
  "backend/app/api/routes/linkedin_auth.py"
  "backend/app/api/routes/posts.py"
  "backend/app/services/linkedin_posts.py"
  "backend/app/models.py"
  "backend/app/crud.py"
  "backend/app/api/main.py"
  "backend/app/core/config.py"
  "backend/app/core/security.py"
  "frontend/src/components/Post/"
  "frontend/src/components/PostInput/"
  "frontend/src/components/Common/PlatformSelector.tsx"
  "frontend/src/components/Common/UserInfo.tsx"
  "frontend/src/routes/"
  "frontend/public/assets/images/"
  "docs/LINKEDIN_SETUP.md"
  "docs/X_SETUP.md"
  "docs/specs/"
  "docs/BRANDKIT.md"
  "AGENTS.md"
)

# Files that should always use UPSTREAM changes (config/infrastructure)
THEIR_FILES=(
  "package.json"
  "bun.lock"
  "compose.yml"
  "compose.override.yml"
  "compose.traefik.yml"
  "uv.lock"
  "frontend/package.json"
  "frontend/bun.lock"
  ".github/workflows/"
  ".pre-commit-config.yaml"
  "pyproject.toml"
  "backend/Dockerfile"
  "frontend/Dockerfile"
  "frontend/Dockerfile.playwright"
  ".github/dependabot.yml"
)

TOTAL=${#COMMITS[@]}
CURRENT=0

for commit in "${COMMITS[@]}"; do
  CURRENT=$((CURRENT + 1))
  COMMIT_MSG=$(git log -1 --pretty=format:'%s' "$commit")
  echo "[$CURRENT/$TOTAL] Processing: $commit - $COMMIT_MSG"

  # Try to cherry-pick without committing first
  if git cherry-pick "$commit" --no-commit 2>/dev/null; then
    echo "  ✓ Applied cleanly"
    git commit -m "$COMMIT_MSG" --no-verify
  else
    echo "  ⚠ Conflicts detected, auto-resolving..."

    # Check for conflicts
    CONFLICTED_FILES=$(git diff --name-only --diff-filter=U)

    if [ -z "$CONFLICTED_FILES" ]; then
      echo "  ✓ No conflicts, committing..."
      git commit -m "$COMMIT_MSG" --no-verify
      continue
    fi

    # Resolve conflicts based on file patterns
    for file in $CONFLICTED_FILES; do
      # Check if file matches OUR_FILES patterns
      USE_OURS=false
      for pattern in "${OUR_FILES[@]}"; do
        if [[ "$file" == $pattern* ]] || [[ "$file" == *"$pattern"* ]]; then
          USE_OURS=true
          break
        fi
      done

      # Check if file matches THEIR_FILES patterns
      USE_THEIRS=false
      for pattern in "${THEIR_FILES[@]}"; do
        if [[ "$file" == $pattern* ]] || [[ "$file" == *"$pattern"* ]]; then
          USE_THEIRS=true
          break
        fi
      done

      if [ "$USE_OURS" = true ]; then
        echo "    → Keeping OUR version: $file"
        git checkout --ours "$file"
        git add "$file"
      elif [ "$USE_THEIRS" = true ]; then
        echo "    → Accepting UPSTREAM version: $file"
        git checkout --theirs "$file"
        git add "$file"
      else
        # For mixed files, prefer ours but mark for review
        echo "    → Manual review needed: $file (keeping ours)"
        git checkout --ours "$file"
        git add "$file"
      fi
    done

    # Complete the cherry-pick
    git commit -m "$COMMIT_MSG [merged]" --no-verify
    echo "  ✓ Resolved and committed"
  fi
  echo ""
done

echo ""
echo "✅ Cherry-pick phase complete!"
echo ""
