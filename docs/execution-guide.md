# ECS Fargate Spot Failover System - Execution Guide

## Overview

This guide provides step-by-step instructions for executing and operating the ECS Fargate Spot Failover System in production environments. It covers system startup, monitoring, troubleshooting, and maintenance procedures.

## Prerequisites

Before executing the system, ensure you have:

- AWS CLI configured with appropriate permissions
- Node.js >= 16.x installed
- AWS CDK >= 2.x installed
- Required AWS services available in your region:
  - Amazon ECS
  - AWS Lambda
  - Amazon DynamoDB
  - Amazon EventBridge
  - Amazon SNS
  - Amazon VPC

## System Execution Steps

### 1. Environment Preparation

#### 1.1 Verify AWS Credentials
```bash
aws sts get-caller-identity
```

#### 1.2 Check Required Permissions
Ensure your AWS credentials have the following permissions:
- `ecs:*` (ECS full access)
- `lambda:*` (Lambda full access)
- `dynamodb:*` (DynamoDB full access)
- `events:*` (EventBridge full access)
- `sns:*` (SNS full access)
- `iam:CreateRole`, `iam:AttachRolePolicy` (IAM role management)
- `ec2:CreateVpc`, `ec2:CreateSubnet` (VPC management)

#### 1.3 Install Dependencies
```bash
npm install
```

#### 1.4 Build the Project
```bash
npm run build
```

### 2. Infrastructure Deployment

#### 2.1 Bootstrap CDK (First-time deployment only)
```bash
cdk bootstrap
```

#### 2.2 Deploy the Stack
```bash
cdk deploy
```

**Expected Output:**
- ECS Cluster created
- Lambda functions deployed
- DynamoDB table created
- EventBridge rules configured
- SNS topic created

#### 2.3 Record Deployment Outputs
After successful deployment, record these important values:
- Cluster Name: `fargate-spot-cluster`
- DynamoDB Table: `fargate-spot-error-counter`
- SNS Topic ARN: `arn:aws:sns:region:account:fargate-spot-failover-notifications`

### 3. Service Configuration

#### 3.1 Create Sample Services
```bash
# Get VPC information
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=EcsFargateSpotFailoverStack/FargateSpotVpc" --query 'Vpcs[0].VpcId' --output text)
SUBNET_1=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*Private*" --query 'Subnets[0].SubnetId' --output text)
SUBNET_2=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*Private*" --query 'Subnets[1].SubnetId' --output text)
SECURITY_GROUP=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text)

# Create services
./scripts/create-sample-services.sh fargate-spot-cluster $SUBNET_1 $SUBNET_2 $SECURITY_GROUP
```

#### 3.2 Configure Notifications (Optional)
```bash
# Add email subscription
aws sns subscribe \
  --topic-arn <NOTIFICATION_TOPIC_ARN> \
  --protocol email \
  --notification-endpoint your-email@example.com

# Confirm subscription (check your email)
```

### 4. System Verification

#### 4.1 Verify Infrastructure Components
```bash
# Check Lambda functions
aws lambda list-functions --query 'Functions[?contains(FunctionName, `EcsFargateSpotFailover`)].FunctionName'

# Check EventBridge rules
aws events list-rules --query 'Rules[?contains(Name, `EcsFargateSpotFailover`)].Name'

# Check DynamoDB table
aws dynamodb describe-table --table-name fargate-spot-error-counter

# Check ECS services
aws ecs list-services --cluster fargate-spot-cluster
```

#### 4.2 Test System Functionality
```bash
# Run failover test
./scripts/test-failover.sh fargate-spot-cluster sample-app
```

**Expected Test Results:**
- Error counter increments with each simulated failure
- Failover triggers after 3 consecutive failures
- Standard Fargate service starts
- Spot service stops
- Notifications sent via SNS

### 5. Production Operation

#### 5.1 Start System Monitoring
```bash
# Start real-time monitoring
./scripts/monitor-system.sh fargate-spot-cluster
```

#### 5.2 Monitor Key Metrics
- **Service Health**: Running vs Desired task counts
- **Error Rates**: DynamoDB error counter values
- **Failover Events**: SNS notifications
- **Lambda Execution**: CloudWatch logs

#### 5.3 Normal Operation Indicators
- Spot services running with desired task count
- Error counters at zero or low values
- No active failover states in DynamoDB
- Regular success notifications

## Operational Procedures

### Daily Operations

#### Morning Checklist
1. Check system status via monitoring script
2. Review overnight CloudWatch logs
3. Verify all services are running normally
4. Check for any pending SNS notifications

#### Health Check Commands
```bash
# Quick system status
aws ecs describe-services --cluster fargate-spot-cluster --services sample-app sample-app-standard

# Check error counters
aws dynamodb scan --table-name fargate-spot-error-counter

# Review recent Lambda logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/EcsFargateSpotFailover"
```

### Weekly Maintenance

#### Performance Review
1. Analyze failover frequency and patterns
2. Review cost savings from Spot instance usage
3. Check Lambda function performance metrics
4. Validate backup service configurations

#### System Updates
```bash
# Update dependencies
npm update

# Rebuild and redeploy if needed
npm run build
cdk deploy
```

### Emergency Procedures

#### Manual Failover
If automatic failover fails, manually switch services:
```bash
# Stop Spot service
aws ecs update-service --cluster fargate-spot-cluster --service sample-app --desired-count 0

# Start standard service
aws ecs update-service --cluster fargate-spot-cluster --service sample-app-standard --desired-count 2
```

#### Manual Recovery
To manually switch back to Spot instances:
```bash
# Start Spot service
aws ecs update-service --cluster fargate-spot-cluster --service sample-app --desired-count 2

# Wait for stability, then stop standard service
aws ecs update-service --cluster fargate-spot-cluster --service sample-app-standard --desired-count 0

# Clear failover state
aws dynamodb delete-item --table-name fargate-spot-error-counter --key '{"service_name":{"S":"sample-app"}}'
```

## Performance Monitoring

### Key Performance Indicators (KPIs)

1. **Availability Metrics**
   - Service uptime percentage
   - Mean time to recovery (MTTR)
   - Failover success rate

2. **Cost Metrics**
   - Spot instance cost savings
   - Standard instance usage time
   - Overall compute cost reduction

3. **Operational Metrics**
   - Failover frequency
   - False positive rate
   - System response time

### Monitoring Tools

#### CloudWatch Dashboards
Create custom dashboards to monitor:
- ECS service metrics
- Lambda function invocations
- DynamoDB read/write operations
- SNS message delivery

#### Alerting Setup
Configure CloudWatch alarms for:
- High error rates
- Failed Lambda executions
- DynamoDB throttling
- Service deployment failures

## Troubleshooting Common Issues

### Issue: Lambda Functions Not Triggering
**Symptoms**: No failover despite Spot failures
**Solution**:
1. Check EventBridge rule configuration
2. Verify Lambda function permissions
3. Review CloudWatch logs for errors

### Issue: Services Not Switching
**Symptoms**: Failover triggered but services unchanged
**Solution**:
1. Verify ECS service permissions
2. Check service configurations
3. Ensure backup services exist

### Issue: High False Positive Rate
**Symptoms**: Frequent unnecessary failovers
**Solution**:
1. Adjust failure threshold in Lambda environment variables
2. Review error detection patterns
3. Fine-tune Spot error identification logic

## Best Practices

### Configuration Management
- Use infrastructure as code (CDK) for all deployments
- Version control all configuration changes
- Test changes in staging environment first

### Security
- Follow principle of least privilege for IAM roles
- Regularly rotate access keys
- Enable CloudTrail for audit logging

### Cost Optimization
- Monitor Spot instance pricing trends
- Adjust instance types based on workload requirements
- Review and optimize resource allocation regularly

## System Shutdown

### Graceful Shutdown Procedure
1. Stop all ECS services
2. Delete Lambda functions
3. Remove EventBridge rules
4. Clean up DynamoDB table
5. Delete SNS topic
6. Remove VPC and associated resources

```bash
# Complete system teardown
cdk destroy
```

### Data Backup
Before shutdown, backup:
- DynamoDB table data
- CloudWatch logs
- Configuration files
- Custom scripts and modifications

## Support and Escalation

### Log Collection
For support requests, collect:
- CloudWatch logs from all Lambda functions
- ECS service event logs
- DynamoDB table contents
- SNS delivery logs

### Contact Information
- **Primary Support**: [Your team contact]
- **Escalation**: [Management contact]
- **Emergency**: [24/7 support contact]

---

**Document Version**: 1.0  
**Last Updated**: [Current Date]  
**Next Review**: [Review Date]