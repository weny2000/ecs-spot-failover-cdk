# Testing Guide

This guide explains how to test the ECS Fargate Spot Failover solution.

## Table of Contents

- [Unit Testing](#unit-testing)
- [Integration Testing](#integration-testing)
- [End-to-End Testing](#end-to-end-testing)
- [Performance Testing](#performance-testing)
- [Manual Failover Testing](#manual-failover-testing)

## Unit Testing

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests
npm run test:unit

# With coverage report
npm run test:coverage

# Watch mode (for development)
npm run test:watch
```

### Test Structure

```
test/
├── setup.ts                    # Jest global setup
├── __mocks__/                  # Mock functions
│   └── aws-sdk-client-mock.ts
└── unit/
    ├── lambda/                 # Lambda function tests
    │   ├── cleanup-orchestrator.test.ts
    │   ├── fargate-failback-orchestrator.test.ts
    │   ├── spot-error-detector.test.ts
    │   └── spot-success-monitor.test.ts
    └── stacks/                 # CDK stack tests
        └── ecs-fargate-spot-failover-stack.test.ts
```

### Lambda Function Test Coverage

#### Spot Error Detector

Test scenarios:
- ✅ Event validation (no detail, non-STOPPED status, non-Spot errors)
- ✅ Error detection (SpotInterruption, ResourcesNotAvailable, insufficient capacity)
- ✅ Error counter increment
- ✅ Service name extraction
- ✅ Failover trigger (threshold reached, already active, threshold not reached)
- ✅ Error handling

#### Fargate Failback Orchestrator

Test scenarios:
- ✅ Event parsing (direct invocation, EventBridge format, environment variable fallback)
- ✅ Skip conditions (failover already active)
- ✅ Failover execution:
  - Start standard service
  - Stop Spot service
  - Update DynamoDB status
  - Reset error counter
  - Send notification
- ✅ Error handling

#### Cleanup Orchestrator

Test scenarios:
- ✅ Event parsing
- ✅ Skip conditions (no failover status, failover not active)
- ✅ Cleanup delay
- ✅ Recovery execution:
  - Restore Spot service
  - Stop standard service
  - Update DynamoDB
  - Reset error counter
  - Send notification
- ✅ Timeout handling
- ✅ Error handling

#### Spot Success Monitor

Test scenarios:
- ✅ Event validation
- ✅ Spot task detection (capacity provider, group name)
- ✅ Error counter reset
- ✅ Recovery trigger (active, in-progress, not active)
- ✅ Service name extraction
- ✅ Error handling

### CDK Stack Tests

Test contents:
- ✅ VPC configuration (CIDR, subnets, NAT Gateway)
- ✅ ECS cluster (capacity providers)
- ✅ DynamoDB table (Schema, billing mode)
- ✅ SNS Topic
- ✅ Lambda functions (configuration, environment variables)
- ✅ IAM roles (permission policies)
- ✅ EventBridge rules (event patterns, targets)
- ✅ ECS services (task definitions, capacity strategies)
- ✅ ALB (listeners, target groups)
- ✅ Configuration options (createSampleApp, desiredCount, appPort)

## Integration Testing

### Prerequisites

```bash
# Deploy test environment
npm run deploy

# Get outputs
export CLUSTER_NAME=$(aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ClusterName`].OutputValue' \
  --output text)

export SPOT_SERVICE=$(aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SpotServiceName`].OutputValue' \
  --output text)

export STANDARD_SERVICE=$(aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`StandardServiceName`].OutputValue' \
  --output text)
```

### Testing DynamoDB Integration

```bash
# Insert test data
aws dynamodb put-item \
  --table-name fargate-spot-error-counter \
  --item '{
    "service_name": {"S": "test-service"},
    "error_count": {"N": "0"},
    "failover_state": {"M": {"failover_active": {"BOOL": false}}}
  }'

# Query data
aws dynamodb get-item \
  --table-name fargate-spot-error-counter \
  --key '{"service_name": {"S": "test-service"}}'

# Delete test data
aws dynamodb delete-item \
  --table-name fargate-spot-error-counter \
  --key '{"service_name": {"S": "test-service"}}'
```

### Testing Lambda Integration

```bash
# Get Lambda function name
DETECTOR_NAME=$(aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `SpotErrorDetector`)].FunctionName' \
  --output text)

# Test event
aws lambda invoke \
  --function-name $DETECTOR_NAME \
  --payload '{
    "detail": {
      "clusterArn": "arn:aws:ecs:us-east-1:123456789012:cluster/'$CLUSTER_NAME'",
      "taskArn": "arn:aws:ecs:us-east-1:123456789012:task/test",
      "group": "service:'$SPOT_SERVICE'",
      "lastStatus": "STOPPED",
      "stoppedReason": "SpotInterruption"
    }
  }' \
  /dev/stdout
```

### Testing SNS Integration

```bash
# Get Topic ARN
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`NotificationTopicArn`].OutputValue' \
  --output text)

# Publish test message
aws sns publish \
  --topic-arn $TOPIC_ARN \
  --subject "Test Notification" \
  --message "This is a test message"
```

## End-to-End Testing

### Complete Failover Test

```bash
#!/bin/bash
# test-failover.sh

echo "=== Starting Failover Test ==="

# 1. Confirm initial state
echo "Checking initial state..."
aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SPOT_SERVICE $STANDARD_SERVICE

# 2. Manually trigger Spot service errors (by stopping tasks)
echo "Stopping Spot tasks to simulate failures..."
for i in {1..3}; do
  TASKS=$(aws ecs list-tasks \
    --cluster $CLUSTER_NAME \
    --service-name $SPOT_SERVICE \
    --query 'taskArns[]' \
    --output text)
  
  if [ ! -z "$TASKS" ]; then
    aws ecs stop-task \
      --cluster $CLUSTER_NAME \
      --task $(echo $TASKS | cut -d' ' -f1) \
      --reason "Testing failover"
  fi
  
  sleep 10
done

# 3. Wait for failover
echo "Waiting for failover..."
sleep 120

# 4. Verify standard service is running
echo "Verifying standard service is running..."
aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --service-name $STANDARD_SERVICE

# 5. Restore Spot service
echo "Restoring Spot service..."
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SPOT_SERVICE \
  --desired-count 2

# 6. Wait for recovery
echo "Waiting for recovery..."
sleep 120

# 7. Verify cleanup completed
echo "Verifying cleanup..."
aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SPOT_SERVICE $STANDARD_SERVICE

echo "=== Test Complete ==="
```

## Performance Testing

### Lambda Cold Start Test

```bash
# Force cold start and measure time
for i in {1..5}; do
  echo "Test $i:"
  time aws lambda invoke \
    --function-name $DETECTOR_NAME \
    --payload '{}' \
    /dev/null
done
```

### ECS Service Startup Time Test

```bash
# Measure service startup time
START_TIME=$(date +%s)

aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $STANDARD_SERVICE \
  --desired-count 2

# Wait for service stabilization
aws ecs wait services-stable \
  --cluster $CLUSTER_NAME \
  --services $STANDARD_SERVICE

END_TIME=$(date +%s)
echo "Startup time: $((END_TIME - START_TIME)) seconds"
```

## Manual Failover Testing

### Method 1: Stop Spot Tasks

```bash
# Get and stop Spot tasks
TASK=$(aws ecs list-tasks \
  --cluster $CLUSTER_NAME \
  --service-name $SPOT_SERVICE \
  --query 'taskArns[0]' \
  --output text)

aws ecs stop-task \
  --cluster $CLUSTER_NAME \
  --task $TASK \
  --reason "Manual test - SpotInterruption"
```

### Method 2: Modify Service Capacity

```bash
# Simulate insufficient capacity
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SPOT_SERVICE \
  --desired-count 0

# Restore later
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SPOT_SERVICE \
  --desired-count 2
```

### Method 3: Manually Invoke Lambda

```bash
# Directly trigger failover
FAILOVER_NAME=$(aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `FailbackOrchestrator`)].FunctionName' \
  --output text)

aws lambda invoke \
  --function-name $FAILOVER_NAME \
  --payload '{
    "serviceName": "'$SPOT_SERVICE'",
    "clusterArn": "arn:aws:ecs:us-east-1:123456789012:cluster/'$CLUSTER_NAME'"
  }' \
  /dev/stdout
```

## Monitoring Test Execution

### Real-time Log Monitoring

```bash
# Monitor all related logs
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-SpotErrorDetector" --follow &
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-FargateFailbackOrchestrator" --follow &
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-SpotSuccessMonitor" --follow &
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-CleanupOrchestrator" --follow &

# Monitor ECS events
aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SPOT_SERVICE $STANDARD_SERVICE \
  --query 'services[].events[:3]'
```

### DynamoDB Monitoring

```bash
# Watch error counter changes
watch -n 5 'aws dynamodb scan --table-name fargate-spot-error-counter'
```

## Testing Checklist

### Pre-deployment Checks

- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `npm run synth` generates valid template
- [ ] Code review completed

### Post-deployment Verification

- [ ] CloudFormation stack created successfully
- [ ] ECS services running normally
- [ ] Lambda functions invocable
- [ ] EventBridge rules enabled
- [ ] DynamoDB table accessible
- [ ] SNS Topic publishable
- [ ] ALB health checks passing

### Functional Tests

- [ ] Failover triggers correctly
- [ ] Standard service starts correctly
- [ ] Spot service stops correctly
- [ ] Recovery triggers correctly
- [ ] Cleanup completes correctly
- [ ] Notifications sent correctly

## Troubleshooting Tests

### Testing Error Scenarios

```bash
# Test Lambda behavior when DynamoDB is unavailable
aws iam detach-role-policy \
  --role-name EcsFargateSpotFailoverStack-LambdaExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess

# Execute test
# ...

# Restore permissions
aws iam attach-role-policy \
  --role-name EcsFargateSpotFailoverStack-LambdaExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Run tests
        run: npm run test:coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Best Practices

1. **Test Isolation**: Each test should be independent and not depend on other test states
2. **Mock External Dependencies**: Use mocks for AWS services without actual calls
3. **Test Naming**: Use descriptive behavior names, such as `should trigger failover when threshold reached`
4. **Coverage**: Maintain core code coverage > 80%
5. **Continuous Integration**: Run full test suite before each commit
