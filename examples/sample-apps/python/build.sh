#!/bin/bash
#
# Build and Push Docker Image to Amazon ECR (Python)
#
# Usage: ./build.sh [version] [aws-region] [ecr-repo-name]

set -e

VERSION=${1:-latest}
AWS_REGION=${2:-us-east-1}
ECR_REPO_NAME=${3:-sample-app-python}

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}=== Python Sample App Build ===${NC}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URL="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_URI="${ECR_URL}/${ECR_REPO_NAME}:${VERSION}"

echo "Building: $IMAGE_URI"

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_URL

# Create repo if not exists
aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $AWS_REGION 2>/dev/null || \
    aws ecr create-repository --repository-name $ECR_REPO_NAME --region $AWS_REGION

# Build
docker build -f Dockerfile.production -t $ECR_REPO_NAME:$VERSION .
docker tag $ECR_REPO_NAME:$VERSION $IMAGE_URI
docker push $IMAGE_URI

echo -e "${GREEN}✓ Build complete: $IMAGE_URI${NC}"
