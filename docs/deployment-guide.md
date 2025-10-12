# ECS Fargate Spot Failover System Deployment Guide

## Prerequisites

1. **AWS CLI Configuration**

   ```bash
   aws configure
   ```

2. **Node.js and npm**

   ```bash
   node --version  # >= 16.x
   npm --version
   ```

3. **AWS CDK**

   ```bash
   npm install -g aws-cdk
   cdk --version
   ```

4. **Required AWS Permissions**
   - ECS full access permissions
   - Lambda full access permissions
   - DynamoDB full access permissions
   - EventBridge full access permissions
   - SNS full access permissions
   - IAM role creation permissions

## Deployment Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Build Project

```bash
npm run build
```

### 3. Initialize CDK (First Deployment)

```bash
cdk bootstrap
```

### 4. Deploy Infrastructure

```bash
cdk deploy
```

After deployment, record the important output information:

- Cluster name
- DynamoDB table name
- SNS topic ARN

### 5. Configure SNS Notifications (Optional)

```bash
# Add email subscription
aws sns subscribe \
  --topic-arn <NOTIFICATION_TOPIC_ARN> \
  --protocol email \
  --notification-endpoint your-email@example.com

# Confirm subscription (check email)
```

### 6. Create Sample Services

```bash
# Get VPC information
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=EcsFargateSpotFailoverStack/FargateSpotVpc" --query 'Vpcs[0].VpcId' --output text)
SUBNET_1=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*Private*" --query 'Subnets[0].SubnetId' --output text)
SUBNET_2=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*Private*" --query 'Subnets[1].SubnetId' --output text)
SECURITY_GROUP=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text)

# Create sample services
./scripts/create-sample-services.sh fargate-spot-cluster $SUBNET_1 $SUBNET_2 $SECURITY_GROUP
```

## Verify Deployment

### 1. Check Infrastructure

```bash
# Check Lambda functions
aws lambda list-functions --query 'Functions[?contains(FunctionName, `EcsFargateSpotFailover`)].FunctionName'

# Check EventBridge rules
aws events list-rules --query 'Rules[?contains(Name, `EcsFargateSpotFailover`)].Name'

# Check DynamoDB table
aws dynamodb describe-table --table-name fargate-spot-error-counter
```

### 2. Test Failover

```bash
# Run test script
./scripts/test-failover.sh fargate-spot-cluster sample-app
```

### 3. Monitor System Status

```bash
# Start monitoring script
./scripts/monitor-system.sh fargate-spot-cluster
```

## Configuration Parameters

### Environment Variables

You can adjust system behavior by modifying environment variables in the CDK stack:

- `FAILURE_THRESHOLD`: Number of consecutive failures to trigger failover (default: 3)
- `CLEANUP_DELAY`: Wait time before cleanup (seconds, default: 30)

### Lambda Function Timeout

Default timeout is 5 minutes, can be adjusted as needed.

## Troubleshooting

### Common Issues

1. **Insufficient Lambda Function Permissions**

   - Check IAM role permissions
   - Ensure Lambda functions can access ECS, DynamoDB, and SNS

2. **EventBridge Rules Not Triggered**

   - Check event pattern configuration
   - Verify ECS cluster ARN matches

3. **Service Creation Failed**
   - Check subnet and security group configuration
   - Ensure ECS task execution role exists

### View Logs

```bash
# View Lambda function logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/EcsFargateSpotFailover"

# View specific function logs
aws logs get-log-events --log-group-name "/aws/lambda/EcsFargateSpotFailoverStack-SpotErrorDetector" --log-stream-name <stream-name>
```

## Clean Up Resources

```bash
# Delete sample services
aws ecs update-service --cluster fargate-spot-cluster --service sample-app --desired-count 0
aws ecs update-service --cluster fargate-spot-cluster --service sample-app-standard --desired-count 0
aws ecs delete-service --cluster fargate-spot-cluster --service sample-app
aws ecs delete-service --cluster fargate-spot-cluster --service sample-app-standard

# Delete CDK stack
cdk destroy
```
