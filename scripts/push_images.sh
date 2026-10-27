#!/usr/bin/env bash
# Build and push the Lambda and AgentCore images (ARM64) to ECR. Run from the repo root.
set -euo pipefail
TAG="${1:-latest}"
REGION="${AWS_REGION:-us-west-2}"
LAMBDA_REPO=$(terraform -chdir=infra output -raw ecr_lambda)
AGENT_REPO=$(terraform -chdir=infra output -raw ecr_agent)
REGISTRY="${LAMBDA_REPO%%/*}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker buildx build --platform linux/arm64 --provenance=false -f api/Dockerfile.lambda -t "$LAMBDA_REPO:$TAG" --push api
docker buildx build --platform linux/arm64 --provenance=false -f api/Dockerfile.agent -t "$AGENT_REPO:$TAG" --push api
echo "Pushed $TAG. Now run: terraform -chdir=infra apply -var image_tag=$TAG"
