#!/usr/bin/env bash
# Build the web app and upload it behind CloudFront. Run from the repo root.
set -euo pipefail
BUCKET=$(terraform -chdir=infra output -raw web_bucket)
DIST=$(terraform -chdir=infra output -raw distribution_id)
# Cognito settings baked into the build (docs/auth-contract.md, "Web config").
# Plain assignments (not `export X=$(...)`) so set -e stops on a missing output.
VITE_COGNITO_AUTHORITY=$(terraform -chdir=infra output -raw cognito_authority)
VITE_COGNITO_CLIENT_ID=$(terraform -chdir=infra output -raw cognito_client_id)
VITE_COGNITO_DOMAIN=$(terraform -chdir=infra output -raw cognito_hosted_ui_domain)
export VITE_AUTH_MODE=cognito VITE_COGNITO_AUTHORITY VITE_COGNITO_CLIENT_ID VITE_COGNITO_DOMAIN
(cd web && npm ci && npm run build)
aws s3 sync web/dist/ "s3://$BUCKET" --delete
# The CLI guesses MIME types from the OS. On Windows .js can come out as text/plain (browsers
# refuse to run it as a module) and .webp as binary/octet-stream. Rewrite those objects in place.
set_type() { # <extension> <content type>
  for key in $(aws s3api list-objects-v2 --bucket "$BUCKET" --query "Contents[?ends_with(Key,'.$1')].Key" --output text); do
    aws s3 cp "s3://$BUCKET/$key" "s3://$BUCKET/$key" --content-type "$2" --metadata-directive REPLACE >/dev/null
  done
}
set_type js text/javascript
set_type webp image/webp
# MSYS_NO_PATHCONV: Git Bash on Windows would otherwise rewrite "/index.html" into a Windows path.
MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/index.html" >/dev/null
echo "Live at $(terraform -chdir=infra output -raw web_url)"
