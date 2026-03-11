# Deployment Guide

This guide provides detailed instructions on how to deploy the ECS Fargate Spot Automatic Failover Solution.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Deployment](#quick-deployment)
- [Step-by-Step Deployment](#step-by-step-deployment)
- [Configuration Options](#configuration-options)
- [Verify Deployment](#verify-deployment)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### 1. AWS Account Requirements

- Valid AWS account
- Permissions for the following services:
  - Amazon ECS
  - AWS Lambda
  - Amazon DynamoDB
  - Amazon EventBridge
  - Amazon SNS
  - Amazon VPC
  - Application Load Balancer
  - AWS CloudWatch
  - AWS IAM

### 2. Local Environment Requirements

| Tool | Minimum Version | Installation Link |
|------|-----------------|-------------------|
| Node.js | 18.x | [Download](https://nodejs.org/) |
| AWS CLI | 2.x | [Installation Guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) |
| AWS CDK | 2.100+ | `npm install -g aws-cdk` |
| Git | 2.x | [Download](https://git-scm.com/) |

### 3. AWS Configuration

```bash
# Configure AWS CLI
aws configure

# Verify configuration
aws sts get-caller-identity
```

### 4. CDK Bootstrap

If this is your first time using CDK in your AWS account:

```bash
# Bootstrap CDK (only required once per region)
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>

# Example
cdk bootstrap aws://123456789012/us-east-1
```

## Quick Deployment

### Option 1: Full Deployment (Recommended)

Deploy the complete solution with sample application:

```bash
# Clone the project
git clone https://github.com/yourusername/ecs-fargate-spot-failover.git
cd ecs-fargate-spot-failover

# Install dependencies
npm install

# One-click deployment
npm run deploy
```

After deployment completes, you will see output similar to:

```
EcsFargateSpotFailoverStack: creating CloudFormation changeset...

 ✅  EcsFargateSpotFailoverStack

Outputs:
EcsFargateSpotFailoverStack.ClusterName = fargate-spot-cluster
EcsFargateSpotFailoverStack.ErrorCounterTableName = fargate-spot-error-counter
EcsFargateSpotFailoverStack.LoadBalancerDNS = EcsFa-XXXXX.us-east-1.elb.amazonaws.com
EcsFargateSpotFailoverStack.NotificationTopicArn = arn:aws:sns:us-east-1:123456789012:...
EcsFargateSpotFailoverStack.SpotServiceName = sample-app
EcsFargateSpotFailoverStack.StandardServiceName = sample-app-standard
```

### Option 2: Minimal Deployment

Deploy only the failover mechanism (for scenarios with existing ECS services):

```bash
npm run deploy:minimal
```

### Option 3: Custom Deployment

```bash
# Customize replica count
npm run deploy -- -c sampleAppDesiredCount=4

# Customize application port
npm run deploy -- -c appPort=8080

# Customize both replica count and port
npm run deploy -- -c sampleAppDesiredCount=3 -c appPort=3000
```

## Step-by-Step Deployment

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Compile TypeScript

```bash
npm run build
```

### Step 3: View Changes

```bash
npm run diff
```

### Step 4: Synthesize CloudFormation Template

```bash
npm run synth
```

This will generate the `cdk.out/` directory containing the CloudFormation templates.

### Step 5: Deploy

```bash
npm run deploy
```

## Configuration Options

### CDK Context Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `createSampleApp` | boolean | `true` | Whether to create the sample application |
| `sampleAppDesiredCount` | number | `2` | Initial replica count for Spot service |
| `appPort` | number | `80` | Application port |

### Environment Variable Configuration

Edit Lambda function environment variables (in `src/ecs-fargate-spot-failover-stack.ts`):

```typescript
// Spot Error Detector
spotErrorDetector.addEnvironment('FAILURE_THRESHOLD', '3');  // Failover threshold

// Cleanup Orchestrator
cleanupOrchestrator.addEnvironment('CLEANUP_DELAY', '30');   // Cleanup delay (seconds)

// All orchestrators
orchestrator.addEnvironment('SERVICE_STABLE_TIMEOUT', '300');  // Service stable timeout (seconds)
```

### Redeploy After Changes

```bash
npm run build && npm run deploy
```

## Verify Deployment

### 1. Check CloudFormation Stack

```bash
aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs'
```

### 2. Verify ECS Services

```bash
# View cluster
aws ecs describe-clusters --clusters fargate-spot-cluster

# View services
aws ecs describe-services \
  --cluster fargate-spot-cluster \
  --services sample-app sample-app-standard
```

### 3. Verify Lambda Functions

```bash
# List all Lambda functions
aws lambda list-functions \
  --query 'Functions[?starts_with(FunctionName, `EcsFargateSpotFailoverStack`)].FunctionName'

# Test Spot Error Detector
aws lambda invoke \
  --function-name EcsFargateSpotFailoverStack-SpotErrorDetectorXXXX \
  --payload '{}' \
  /dev/stdout
```

### 4. Verify DynamoDB Table

```bash
# View table structure
aws dynamodb describe-table \
  --table-name fargate-spot-error-counter

# Scan table contents
aws dynamodb scan \
  --table-name fargate-spot-error-counter
```

### 5. Verify EventBridge Rules

```bash
# List rules
aws events list-rules \
  --name-prefix EcsFargateSpotFailoverStack

# View rule details
aws events describe-rule \
  --name EcsFargateSpotFailoverStack-EcsTaskStateChangeRuleXXXX
```

### 6. Access Sample Application

```bash
# Get Load Balancer DNS
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

# Test access
curl http://$ALB_DNS
```

## Configure Alert Notifications

### Email Notifications

```bash
# Get SNS Topic ARN
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`NotificationTopicArn`].OutputValue' \
  --output text)

# Subscribe email
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint your-email@example.com

# Confirm subscription (check email and click confirmation link)
```

### Slack Notifications

1. Create Slack Webhook: [Slack API](https://api.slack.com/messaging/webhooks)
2. Create Lambda function to process SNS messages and send to Slack
3. Subscribe SNS Topic to this Lambda

### SMS Notifications

```bash
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol sms \
  --notification-endpoint +1234567890
```

## Multi-Environment Deployment

### Development Environment

```bash
# Use CDK environment variables
export CDK_DEFAULT_ACCOUNT=123456789012
export CDK_DEFAULT_REGION=us-east-1

# Deploy to development environment
cdk deploy -c env=dev
```

### Production Environment

```bash
# Use different stack name
cdk deploy EcsFargateSpotFailoverStack-Prod \
  -c env=prod \
  -c sampleAppDesiredCount=4
```

### Using cdk.json Configuration

```json
{
  "context": {
    "@aws-cdk/core:enableStackNameDuplicates": true,
    "env": "prod",
    "sampleAppDesiredCount": 4
  }
}
```

## Troubleshooting

### Deployment Failures

#### 1. CDK Bootstrap Not Executed

```
Error: This stack uses assets, so the toolkit stack must be deployed to the environment
```

**Solution**:
```bash
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

#### 2. Insufficient IAM Permissions

```
API: iam:CreateRole User: xxx is not authorized to perform: iam:CreateRole
```

**Solution**: Ensure IAM user/role has sufficient permissions

#### 3. Resource Name Conflict

```
AlreadyExistsException: Stack already exists
```

**Solution**: Use a different stack name or delete the existing stack first

### Runtime Issues

#### Lambda Function Timeout

Check CloudWatch Logs:
```bash
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-FargateFailbackOrchestrator" --follow
```

**Possible Causes**:
- ECS service startup taking too long
- Network connectivity issues

**Solution**: Increase Lambda timeout or adjust `SERVICE_STABLE_TIMEOUT`

#### EventBridge Not Triggering

```bash
# Check rule status
aws events describe-rule --name <rule-name>

# Check target configuration
aws events list-targets-by-rule --rule <rule-name>
```

#### DynamoDB Access Failure

Check if Lambda execution role's IAM policy includes DynamoDB access permissions.

## Update Deployment

### Redeploy After Code Updates

```bash
# Pull latest code
git pull origin main

# Reinstall dependencies (if updated)
npm install

# Compile and deploy
npm run build && npm run deploy
```

### Partial Update

```bash
# Update only Lambda code
npm run build
cdk deploy --hotswap

# Note: --hotswap does not work for infrastructure changes
```

## Rollback Deployment

### Using CloudFormation Rollback

```bash
# View stack history
aws cloudformation describe-stack-events \
  --stack-name EcsFargateSpotFailoverStack

# Rollback to specific version (if available)
aws cloudformation rollback-stack \
  --stack-name EcsFargateSpotFailoverStack
```

### Using CDK Destroy and Rebuild

```bash
# Destroy
cdk destroy

# Redeploy
cdk deploy
```

## Next Steps

After deployment is complete, please refer to the following documentation:

- [Execution Guide](execution-guide.md) - Learn how the system operates
- [Testing Guide](testing-guide.md) - Test the failover functionality
- [Operations Manual](operations-manual.md) - Daily operations
