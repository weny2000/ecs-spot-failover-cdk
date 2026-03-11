# Build and Push Docker Image to Amazon ECR
#
# Usage:
#   .\build.ps1 [version] [aws-region] [ecr-repo-name]
#
# Example:
#   .\build.ps1 v1.0.0 us-east-1 myapp
#

param(
    [string]$Version = "latest",
    [string]$AwsRegion = "us-east-1",
    [string]$EcrRepoName = "sample-app",
    [string]$Dockerfile = "Dockerfile.production"
)

Write-Host "=== ECS Fargate Spot Sample App Build Script ===" -ForegroundColor Yellow
Write-Host "Version: $Version"
Write-Host "AWS Region: $AwsRegion"
Write-Host "ECR Repository: $EcrRepoName"
Write-Host "Dockerfile: $Dockerfile"
Write-Host ""

# Get AWS Account ID
Write-Host "Getting AWS Account ID..." -ForegroundColor Yellow
$AwsAccountId = (aws sts get-caller-identity --query Account --output text)
Write-Host "AWS Account ID: $AwsAccountId"

# Set ECR URL
$EcrUrl = "${AwsAccountId}.dkr.ecr.${AwsRegion}.amazonaws.com"
$ImageUri = "${EcrUrl}/${EcrRepoName}:${Version}"

Write-Host ""
Write-Host "=== Step 1: Login to Amazon ECR ===" -ForegroundColor Yellow
aws ecr get-login-password --region $AwsRegion | docker login --username AWS --password-stdin $EcrUrl

Write-Host ""
Write-Host "=== Step 2: Create ECR Repository (if not exists) ===" -ForegroundColor Yellow
$RepoExists = aws ecr describe-repositories --repository-names $EcrRepoName --region $AwsRegion 2>$null
if (-not $RepoExists) {
    aws ecr create-repository --repository-name $EcrRepoName --region $AwsRegion
}

Write-Host ""
Write-Host "=== Step 3: Build Docker Image ===" -ForegroundColor Yellow
docker build -f $Dockerfile -t ${EcrRepoName}:${Version} .

Write-Host ""
Write-Host "=== Step 4: Tag Image ===" -ForegroundColor Yellow
docker tag ${EcrRepoName}:${Version} $ImageUri
Write-Host "Tagged: $ImageUri"

Write-Host ""
Write-Host "=== Step 5: Push to ECR ===" -ForegroundColor Yellow
docker push $ImageUri

Write-Host ""
Write-Host "=== Build Complete! ===" -ForegroundColor Green
Write-Host "Image URI: $ImageUri" -ForegroundColor Green
Write-Host ""
Write-Host "Use this image URI in your CDK stack:"
Write-Host ""
Write-Host "  ecs.ContainerImage.fromEcrRepository("
Write-Host "    ecr.Repository.fromRepositoryName(stack, 'AppRepo', '$EcrRepoName'),"
Write-Host "    '$Version'"
Write-Host "  )"
Write-Host ""
