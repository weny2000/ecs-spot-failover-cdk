#!/bin/bash
#
# Build and Push Docker Image to Amazon ECR
#
# Usage:
#   ./build.sh [version] [aws-region] [ecr-repo-name]
#
# Example:
#   ./build.sh v1.0.0 us-east-1 myapp
#

set -e

# Configuration
VERSION=${1:-latest}
AWS_REGION=${2:-us-east-1}
ECR_REPO_NAME=${3:-sample-app}
DOCKERFILE=${4:-Dockerfile.production}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== ECS Fargate Spot Sample App Build Script ===${NC}"
echo "Version: $VERSION"
echo "AWS Region: $AWS_REGION"
echo "ECR Repository: $ECR_REPO_NAME"
echo "Dockerfile: $DOCKERFILE"
echo ""

# Get AWS Account ID
echo -e "${YELLOW}Getting AWS Account ID...${NC}"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account ID: $AWS_ACCOUNT_ID"

# Set ECR URL
ECR_URL="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_URI="${ECR_URL}/${ECR_REPO_NAME}:${VERSION}"

echo ""
echo -e "${YELLOW}=== Step 1: Login to Amazon ECR ===${NC}"
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_URL

echo ""
echo -e "${YELLOW}=== Step 2: Create ECR Repository (if not exists) ===${NC}"
aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $AWS_REGION 2>/dev/null || \
    aws ecr create-repository --repository-name $ECR_REPO_NAME --region $AWS_REGION

echo ""
echo -e "${YELLOW}=== Step 3: Build Docker Image ===${NC}"
docker build -f $DOCKERFILE -t $ECR_REPO_NAME:$VERSION .

echo ""
echo -e "${YELLOW}=== Step 4: Tag Image ===${NC}"
docker tag $ECR_REPO_NAME:$VERSION $IMAGE_URI
echo "Tagged: $IMAGE_URI"

echo ""
echo -e "${YELLOW}=== Step 5: Push to ECR ===${NC}"
docker push $IMAGE_URI

echo ""
echo -e "${GREEN}=== Build Complete! ===${NC}"
echo -e "Image URI: ${GREEN}$IMAGE_URI${NC}"
echo ""
echo "Use this image URI in your CDK stack:"
echo ""
echo "  ecs.ContainerImage.fromEcrRepository("
echo "    ecr.Repository.fromRepositoryName(stack, 'AppRepo', '$ECR_REPO_NAME'),"
echo "    '$VERSION'"
echo "  )"
echo ""
