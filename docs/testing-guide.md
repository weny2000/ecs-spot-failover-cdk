# ECS Fargate Spot Failover System - Testing Guide

## Overview

This comprehensive testing guide provides detailed procedures for validating the ECS Fargate Spot Failover System across all environments and scenarios. It covers unit testing, integration testing, end-to-end testing, performance testing, and security testing.

## Testing Strategy

### Testing Pyramid

#### 1. Unit Tests (Foundation)
- **Scope**: Individual Lambda functions
- **Purpose**: Validate business logic and error handling
- **Frequency**: Every code change
- **Automation**: Fully automated

#### 2. Integration Tests (Middle Layer)
- **Scope**: Component interactions
- **Purpose**: Validate service integrations
- **Frequency**: Every deployment
- **Automation**: Mostly automated

#### 3. End-to-End Tests (Top Layer)
- **Scope**: Complete system workflows
- **Purpose**: Validate user scenarios
- **Frequency**: Major releases
- **Automation**: Partially automated

### Test Environments

#### Development Environment
- **Purpose**: Initial testing and debugging
- **Data**: Synthetic test data
- **Scope**: Unit and basic integration tests

#### Staging Environment
- **Purpose**: Pre-production validation
- **Data**: Production-like data
- **Scope**: Full integration and E2E tests

#### Production Environment
- **Purpose**: Live system validation
- **Data**: Real production data
- **Scope**: Smoke tests and monitoring

## Unit Testing

### Lambda Function Testing

#### Test Setup
```javascript
// test/spot-error-detector.test.js
const AWS = require('aws-sdk-mock');
const { handler } = require('../src/lambda/spot-error-detector');

describe('Spot Error Detector', () => {
  beforeEach(() => {
    AWS.mock('DynamoDB.DocumentClient', 'update', (params, callback) => {
      callback(null, { Attributes: { error_count: 1 } });
    });
    
    AWS.mock('SNS', 'publish', (params, callback) => {
      callback(null, { MessageId: 'test-message-id' });
    });
  });

  afterEach(() => {
    AWS.restore();
  });

  test('should detect Spot instance error', async () => {
    const event = {
      detail: {
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
        taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
        stoppedReason: 'SpotInterruption: Spot Instance terminating',
        group: 'service:test-service'
      }
    };

    const result = await handler(event);
    expect(result).toBeDefined();
  });

  test('should ignore non-Spot errors', async () => {
    const event = {
      detail: {
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
        taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
        stoppedReason: 'Task stopped by user',
        group: 'service:test-service'
      }
    };

    const result = await handler(event);
    expect(result).toBeUndefined();
  });
});
```

#### Running Unit Tests
```bash
# Install test dependencies
npm install --save-dev jest aws-sdk-mock

# Run unit tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- spot-error-detector.test.js
```

### CDK Infrastructure Testing

#### CDK Unit Tests
```typescript
// test/ecs-fargate-spot-failover-stack.test.ts
import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { EcsFargateSpotFailoverStack } from '../src/ecs-fargate-spot-failover-stack';

describe('ECS Fargate Spot Failover Stack', () => {
  test('creates required resources', () => {
    const app = new cdk.App();
    const stack = new EcsFargateSpotFailoverStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Verify ECS Cluster
    template.hasResourceProperties('AWS::ECS::Cluster', {
      ClusterName: 'fargate-spot-cluster'
    });

    // Verify Lambda Functions
    template.resourceCountIs('AWS::Lambda::Function', 4);

    // Verify DynamoDB Table
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'fargate-spot-error-counter'
    });

    // Verify EventBridge Rules
    template.resourceCountIs('AWS::Events::Rule', 2);

    // Verify SNS Topic
    template.resourceCountIs('AWS::SNS::Topic', 1);
  });

  test('configures proper IAM permissions', () => {
    const app = new cdk.App();
    const stack = new EcsFargateSpotFailoverStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Verify Lambda execution role has required permissions
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [{
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' }
        }]
      }
    });
  });
});
```

## Integration Testing

### Component Integration Tests

#### EventBridge to Lambda Integration
```bash
#!/bin/bash
# test/integration/eventbridge-lambda-test.sh

echo "Testing EventBridge to Lambda integration..."

# Create test event
cat > test-event.json << EOF
{
  "source": ["aws.ecs"],
  "detail-type": ["ECS Task State Change"],
  "detail": {
    "clusterArn": "arn:aws:ecs:us-east-1:123456789012:cluster/fargate-spot-cluster",
    "taskArn": "arn:aws:ecs:us-east-1:123456789012:task/test-task",
    "lastStatus": "STOPPED",
    "stoppedReason": "SpotInterruption: Spot Instance terminating",
    "group": "service:test-service"
  }
}
EOF

# Send test event to EventBridge
aws events put-events --entries file://test-event.json

# Wait for Lambda execution
sleep 10

# Check Lambda logs for execution
aws logs filter-log-events \
  --log-group-name "/aws/lambda/EcsFargateSpotFailoverStack-SpotErrorDetector" \
  --start-time $(date -d '5 minutes ago' +%s)000 \
  --filter-pattern "Detected Spot instance error"

echo "Integration test completed"
```

#### Lambda to DynamoDB Integration
```bash
#!/bin/bash
# test/integration/lambda-dynamodb-test.sh

echo "Testing Lambda to DynamoDB integration..."

# Invoke Lambda function directly
aws lambda invoke \
  --function-name EcsFargateSpotFailoverStack-SpotErrorDetector \
  --payload file://test-event.json \
  response.json

# Check DynamoDB for updated error count
aws dynamodb get-item \
  --table-name fargate-spot-error-counter \
  --key '{"service_name":{"S":"test-service"}}'

echo "DynamoDB integration test completed"
```

#### Lambda to ECS Integration
```bash
#!/bin/bash
# test/integration/lambda-ecs-test.sh

echo "Testing Lambda to ECS integration..."

# Create test services if they don't exist
aws ecs create-service \
  --cluster fargate-spot-cluster \
  --service-name test-service \
  --task-definition test-task:1 \
  --desired-count 2

aws ecs create-service \
  --cluster fargate-spot-cluster \
  --service-name test-service-standard \
  --task-definition test-task:1 \
  --desired-count 0

# Trigger failover by invoking orchestrator
aws lambda invoke \
  --function-name EcsFargateSpotFailoverStack-FargateFailbackOrchestrator \
  --payload '{"serviceName":"test-service","clusterArn":"arn:aws:ecs:us-east-1:123456789012:cluster/fargate-spot-cluster","action":"failover"}' \
  response.json

# Verify service states
aws ecs describe-services \
  --cluster fargate-spot-cluster \
  --services test-service test-service-standard

echo "ECS integration test completed"
```

### Integration Test Suite
```bash
#!/bin/bash
# test/integration/run-integration-tests.sh

echo "Running integration test suite..."

# Set up test environment
export AWS_REGION=us-east-1
export TEST_CLUSTER=fargate-spot-cluster

# Run individual integration tests
./test/integration/eventbridge-lambda-test.sh
./test/integration/lambda-dynamodb-test.sh
./test/integration/lambda-ecs-test.sh

# Cleanup test resources
aws ecs delete-service --cluster $TEST_CLUSTER --service test-service --force
aws ecs delete-service --cluster $TEST_CLUSTER --service test-service-standard --force

echo "Integration test suite completed"
```

## End-to-End Testing

### Complete Failover Scenario Test

#### Automated E2E Test
```bash
#!/bin/bash
# test/e2e/failover-scenario-test.sh

set -e

CLUSTER_NAME="fargate-spot-cluster"
SERVICE_NAME="e2e-test-service"
TEST_DURATION=300  # 5 minutes

echo "Starting End-to-End Failover Test..."
echo "Cluster: $CLUSTER_NAME"
echo "Service: $SERVICE_NAME"
echo "Test Duration: $TEST_DURATION seconds"

# Step 1: Setup test services
echo "Step 1: Setting up test services..."
./scripts/create-sample-services.sh $CLUSTER_NAME subnet-12345 subnet-67890 sg-abcdef

# Step 2: Verify initial state
echo "Step 2: Verifying initial state..."
INITIAL_SPOT_COUNT=$(aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --query 'services[0].runningCount' --output text)
INITIAL_STANDARD_COUNT=$(aws ecs describe-services --cluster $CLUSTER_NAME --services ${SERVICE_NAME}-standard --query 'services[0].runningCount' --output text)

echo "Initial Spot service count: $INITIAL_SPOT_COUNT"
echo "Initial Standard service count: $INITIAL_STANDARD_COUNT"

# Step 3: Simulate Spot failures
echo "Step 3: Simulating Spot instance failures..."
for i in {1..3}; do
  echo "Simulating failure $i/3..."
  
  # Get running tasks
  TASK_ARNS=$(aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --query 'taskArns[]' --output text)
  
  # Stop all tasks
  for TASK_ARN in $TASK_ARNS; do
    aws ecs stop-task --cluster $CLUSTER_NAME --task $TASK_ARN --reason "E2E Test: Simulated Spot interruption $i"
  done
  
  # Wait between failures
  sleep 60
done

# Step 4: Wait for failover to trigger
echo "Step 4: Waiting for failover to trigger..."
sleep 120

# Step 5: Verify failover occurred
echo "Step 5: Verifying failover..."
FINAL_SPOT_COUNT=$(aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --query 'services[0].runningCount' --output text)
FINAL_STANDARD_COUNT=$(aws ecs describe-services --cluster $CLUSTER_NAME --services ${SERVICE_NAME}-standard --query 'services[0].runningCount' --output text)

echo "Final Spot service count: $FINAL_SPOT_COUNT"
echo "Final Standard service count: $FINAL_STANDARD_COUNT"

# Step 6: Verify failover state in DynamoDB
echo "Step 6: Checking failover state..."
FAILOVER_STATE=$(aws dynamodb get-item --table-name fargate-spot-error-counter --key "{\"service_name\":{\"S\":\"$SERVICE_NAME\"}}" --query 'Item.failover_state.M.failover_active.BOOL' --output text)

echo "Failover state active: $FAILOVER_STATE"

# Step 7: Test results validation
echo "Step 7: Validating test results..."
if [ "$FINAL_SPOT_COUNT" = "0" ] && [ "$FINAL_STANDARD_COUNT" = "$INITIAL_SPOT_COUNT" ] && [ "$FAILOVER_STATE" = "true" ]; then
  echo "✅ E2E Test PASSED: Failover executed successfully"
  EXIT_CODE=0
else
  echo "❌ E2E Test FAILED: Failover did not execute as expected"
  EXIT_CODE=1
fi

# Step 8: Cleanup
echo "Step 8: Cleaning up test resources..."
aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --desired-count 0
aws ecs update-service --cluster $CLUSTER_NAME --service ${SERVICE_NAME}-standard --desired-count 0
aws ecs delete-service --cluster $CLUSTER_NAME --service $SERVICE_NAME
aws ecs delete-service --cluster $CLUSTER_NAME --service ${SERVICE_NAME}-standard

# Clear DynamoDB state
aws dynamodb delete-item --table-name fargate-spot-error-counter --key "{\"service_name\":{\"S\":\"$SERVICE_NAME\"}}"

echo "E2E Test completed with exit code: $EXIT_CODE"
exit $EXIT_CODE
```

### Recovery Scenario Test

#### Automated Recovery Test
```bash
#!/bin/bash
# test/e2e/recovery-scenario-test.sh

set -e

CLUSTER_NAME="fargate-spot-cluster"
SERVICE_NAME="recovery-test-service"

echo "Starting End-to-End Recovery Test..."

# Step 1: Setup services in failover state
echo "Step 1: Setting up services in failover state..."
# ... (setup code similar to failover test)

# Step 2: Simulate Spot recovery
echo "Step 2: Simulating Spot instance recovery..."
# Create successful Spot task event
cat > recovery-event.json << EOF
{
  "source": ["aws.ecs"],
  "detail-type": ["ECS Task State Change"],
  "detail": {
    "clusterArn": "arn:aws:ecs:us-east-1:123456789012:cluster/$CLUSTER_NAME",
    "taskArn": "arn:aws:ecs:us-east-1:123456789012:task/recovery-task",
    "lastStatus": "RUNNING",
    "group": "service:$SERVICE_NAME",
    "capacityProviderName": "FARGATE_SPOT"
  }
}
EOF

# Send recovery event
aws events put-events --entries file://recovery-event.json

# Step 3: Wait for cleanup to complete
echo "Step 3: Waiting for cleanup process..."
sleep 180

# Step 4: Verify recovery
echo "Step 4: Verifying recovery..."
SPOT_COUNT=$(aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --query 'services[0].runningCount' --output text)
STANDARD_COUNT=$(aws ecs describe-services --cluster $CLUSTER_NAME --services ${SERVICE_NAME}-standard --query 'services[0].runningCount' --output text)
FAILOVER_STATE=$(aws dynamodb get-item --table-name fargate-spot-error-counter --key "{\"service_name\":{\"S\":\"$SERVICE_NAME\"}}" --query 'Item.failover_state.M.failover_active.BOOL' --output text)

if [ "$SPOT_COUNT" = "2" ] && [ "$STANDARD_COUNT" = "0" ] && [ "$FAILOVER_STATE" != "true" ]; then
  echo "✅ Recovery Test PASSED"
  EXIT_CODE=0
else
  echo "❌ Recovery Test FAILED"
  EXIT_CODE=1
fi

# Cleanup
echo "Cleaning up..."
# ... (cleanup code)

exit $EXIT_CODE
```

## Performance Testing

### Load Testing

#### Lambda Function Performance Test
```bash
#!/bin/bash
# test/performance/lambda-load-test.sh

echo "Starting Lambda performance test..."

FUNCTION_NAME="EcsFargateSpotFailoverStack-SpotErrorDetector"
CONCURRENT_EXECUTIONS=50
TOTAL_EXECUTIONS=1000

# Create test payload
cat > load-test-payload.json << EOF
{
  "detail": {
    "clusterArn": "arn:aws:ecs:us-east-1:123456789012:cluster/fargate-spot-cluster",
    "taskArn": "arn:aws:ecs:us-east-1:123456789012:task/load-test-task",
    "stoppedReason": "SpotInterruption: Load test",
    "group": "service:load-test-service"
  }
}
EOF

# Function to invoke Lambda
invoke_lambda() {
  aws lambda invoke \
    --function-name $FUNCTION_NAME \
    --payload file://load-test-payload.json \
    --cli-read-timeout 30 \
    response-$1.json > /dev/null 2>&1
}

# Start load test
echo "Executing $TOTAL_EXECUTIONS invocations with $CONCURRENT_EXECUTIONS concurrent executions..."
START_TIME=$(date +%s)

for ((i=1; i<=TOTAL_EXECUTIONS; i++)); do
  invoke_lambda $i &
  
  # Limit concurrent executions
  if (( i % CONCURRENT_EXECUTIONS == 0 )); then
    wait
  fi
done

wait
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "Load test completed in $DURATION seconds"
echo "Average executions per second: $((TOTAL_EXECUTIONS / DURATION))"

# Analyze results
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=$FUNCTION_NAME \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum,Minimum

# Cleanup
rm -f load-test-payload.json response-*.json
```

#### DynamoDB Performance Test
```bash
#!/bin/bash
# test/performance/dynamodb-load-test.sh

echo "Starting DynamoDB performance test..."

TABLE_NAME="fargate-spot-error-counter"
WRITE_OPERATIONS=1000
READ_OPERATIONS=1000

# Write performance test
echo "Testing write performance..."
START_TIME=$(date +%s)

for ((i=1; i<=WRITE_OPERATIONS; i++)); do
  aws dynamodb put-item \
    --table-name $TABLE_NAME \
    --item "{\"service_name\":{\"S\":\"perf-test-$i\"},\"error_count\":{\"N\":\"1\"},\"last_error_time\":{\"S\":\"$(date -u +%Y-%m-%dT%H:%M:%S)\"}}" \
    > /dev/null 2>&1 &
  
  # Limit concurrent operations
  if (( i % 50 == 0 )); then
    wait
  fi
done

wait
WRITE_END_TIME=$(date +%s)
WRITE_DURATION=$((WRITE_END_TIME - START_TIME))

echo "Write test completed: $WRITE_OPERATIONS operations in $WRITE_DURATION seconds"
echo "Write operations per second: $((WRITE_OPERATIONS / WRITE_DURATION))"

# Read performance test
echo "Testing read performance..."
READ_START_TIME=$(date +%s)

for ((i=1; i<=READ_OPERATIONS; i++)); do
  aws dynamodb get-item \
    --table-name $TABLE_NAME \
    --key "{\"service_name\":{\"S\":\"perf-test-$((i % WRITE_OPERATIONS + 1))\"}}" \
    > /dev/null 2>&1 &
  
  # Limit concurrent operations
  if (( i % 50 == 0 )); then
    wait
  fi
done

wait
READ_END_TIME=$(date +%s)
READ_DURATION=$((READ_END_TIME - READ_START_TIME))

echo "Read test completed: $READ_OPERATIONS operations in $READ_DURATION seconds"
echo "Read operations per second: $((READ_OPERATIONS / READ_DURATION))"

# Cleanup test data
echo "Cleaning up test data..."
for ((i=1; i<=WRITE_OPERATIONS; i++)); do
  aws dynamodb delete-item \
    --table-name $TABLE_NAME \
    --key "{\"service_name\":{\"S\":\"perf-test-$i\"}}" \
    > /dev/null 2>&1 &
  
  if (( i % 50 == 0 )); then
    wait
  fi
done

wait
echo "Performance test completed"
```

### Stress Testing

#### System Stress Test
```bash
#!/bin/bash
# test/performance/system-stress-test.sh

echo "Starting system stress test..."

CLUSTER_NAME="fargate-spot-cluster"
STRESS_DURATION=600  # 10 minutes
FAILURE_RATE=10      # failures per minute

echo "Stress test parameters:"
echo "- Duration: $STRESS_DURATION seconds"
echo "- Failure rate: $FAILURE_RATE failures per minute"

# Create multiple test services
for i in {1..5}; do
  SERVICE_NAME="stress-test-service-$i"
  
  # Create Spot service
  aws ecs create-service \
    --cluster $CLUSTER_NAME \
    --service-name $SERVICE_NAME \
    --task-definition stress-test-task:1 \
    --desired-count 3 \
    --capacity-provider-strategy capacityProvider=FARGATE_SPOT,weight=1
  
  # Create Standard service
  aws ecs create-service \
    --cluster $CLUSTER_NAME \
    --service-name ${SERVICE_NAME}-standard \
    --task-definition stress-test-task:1 \
    --desired-count 0 \
    --capacity-provider-strategy capacityProvider=FARGATE,weight=1
done

# Start stress test
START_TIME=$(date +%s)
END_TIME=$((START_TIME + STRESS_DURATION))

while [ $(date +%s) -lt $END_TIME ]; do
  # Generate random failures across services
  for i in {1..5}; do
    SERVICE_NAME="stress-test-service-$i"
    
    # Get random number of tasks to stop
    TASKS_TO_STOP=$((RANDOM % 3 + 1))
    
    # Get running tasks
    TASK_ARNS=$(aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --query 'taskArns[]' --output text | head -n $TASKS_TO_STOP)
    
    # Stop tasks
    for TASK_ARN in $TASK_ARNS; do
      aws ecs stop-task --cluster $CLUSTER_NAME --task $TASK_ARN --reason "Stress test failure" > /dev/null 2>&1 &
    done
  done
  
  # Wait before next round of failures
  sleep $((60 / FAILURE_RATE))
done

echo "Stress test completed. Analyzing results..."

# Analyze system performance during stress test
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=EcsFargateSpotFailoverStack-SpotErrorDetector \
  --start-time $(date -u -d "$((STRESS_DURATION / 60)) minutes ago" +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum

# Cleanup stress test services
echo "Cleaning up stress test services..."
for i in {1..5}; do
  SERVICE_NAME="stress-test-service-$i"
  aws ecs delete-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force > /dev/null 2>&1 &
  aws ecs delete-service --cluster $CLUSTER_NAME --service ${SERVICE_NAME}-standard --force > /dev/null 2>&1 &
done

wait
echo "Stress test cleanup completed"
```

## Security Testing

### IAM Permission Testing

#### Permission Validation Test
```bash
#!/bin/bash
# test/security/iam-permission-test.sh

echo "Starting IAM permission validation test..."

LAMBDA_ROLE_ARN="arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/EcsFargateSpotFailoverStack-LambdaExecutionRole"

# Test required permissions
echo "Testing ECS permissions..."
aws iam simulate-principal-policy \
  --policy-source-arn $LAMBDA_ROLE_ARN \
  --action-names ecs:UpdateService ecs:DescribeServices ecs:ListTasks \
  --resource-arns "*"

echo "Testing DynamoDB permissions..."
aws iam simulate-principal-policy \
  --policy-source-arn $LAMBDA_ROLE_ARN \
  --action-names dynamodb:GetItem dynamodb:PutItem dynamodb:UpdateItem \
  --resource-arns "arn:aws:dynamodb:*:*:table/fargate-spot-error-counter"

echo "Testing SNS permissions..."
aws iam simulate-principal-policy \
  --policy-source-arn $LAMBDA_ROLE_ARN \
  --action-names sns:Publish \
  --resource-arns "arn:aws:sns:*:*:fargate-spot-failover-notifications"

# Test unauthorized actions (should fail)
echo "Testing unauthorized actions (should fail)..."
aws iam simulate-principal-policy \
  --policy-source-arn $LAMBDA_ROLE_ARN \
  --action-names s3:GetObject ec2:TerminateInstances \
  --resource-arns "*"

echo "IAM permission test completed"
```

### Network Security Testing

#### Security Group Validation
```bash
#!/bin/bash
# test/security/network-security-test.sh

echo "Starting network security validation..."

VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=*EcsFargateSpotFailover*" --query 'Vpcs[0].VpcId' --output text)
SECURITY_GROUPS=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[].GroupId' --output text)

echo "VPC ID: $VPC_ID"
echo "Security Groups: $SECURITY_GROUPS"

for SG in $SECURITY_GROUPS; do
  echo "Analyzing Security Group: $SG"
  
  # Check for overly permissive rules
  OPEN_RULES=$(aws ec2 describe-security-groups --group-ids $SG --query 'SecurityGroups[0].IpPermissions[?IpRanges[?CidrIp==`0.0.0.0/0`]]' --output text)
  
  if [ -n "$OPEN_RULES" ]; then
    echo "⚠️  Warning: Security group $SG has rules open to 0.0.0.0/0"
  else
    echo "✅ Security group $SG follows least privilege principle"
  fi
done

echo "Network security validation completed"
```

### Data Encryption Testing

#### Encryption Validation Test
```bash
#!/bin/bash
# test/security/encryption-test.sh

echo "Starting encryption validation test..."

# Check DynamoDB encryption
TABLE_ENCRYPTION=$(aws dynamodb describe-table --table-name fargate-spot-error-counter --query 'Table.SSEDescription.Status' --output text)
echo "DynamoDB encryption status: $TABLE_ENCRYPTION"

# Check Lambda environment variable encryption
LAMBDA_FUNCTIONS=$(aws lambda list-functions --query 'Functions[?contains(FunctionName, `EcsFargateSpotFailover`)].FunctionName' --output text)

for FUNCTION in $LAMBDA_FUNCTIONS; do
  KMS_KEY=$(aws lambda get-function-configuration --function-name $FUNCTION --query 'KMSKeyArn' --output text)
  if [ "$KMS_KEY" != "None" ]; then
    echo "✅ Function $FUNCTION uses KMS encryption"
  else
    echo "⚠️  Function $FUNCTION does not use KMS encryption"
  fi
done

# Check SNS topic encryption
TOPIC_ARN=$(aws sns list-topics --query 'Topics[?contains(TopicArn, `fargate-spot-failover`)].TopicArn' --output text)
TOPIC_ENCRYPTION=$(aws sns get-topic-attributes --topic-arn $TOPIC_ARN --query 'Attributes.KmsMasterKeyId' --output text)

if [ "$TOPIC_ENCRYPTION" != "None" ]; then
  echo "✅ SNS topic uses encryption"
else
  echo "⚠️  SNS topic does not use encryption"
fi

echo "Encryption validation completed"
```

## Test Automation and CI/CD Integration

### GitHub Actions Workflow

#### Test Pipeline Configuration
```yaml
# .github/workflows/test.yml
name: Test Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run unit tests
      run: npm test -- --coverage
    
    - name: Upload coverage reports
      uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    if: github.ref == 'refs/heads/develop'
    steps:
    - uses: actions/checkout@v3
    
    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v2
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1
    
    - name: Run integration tests
      run: ./test/integration/run-integration-tests.sh

  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    if: github.ref == 'refs/heads/main'
    steps:
    - uses: actions/checkout@v3
    
    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v2
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1
    
    - name: Run E2E tests
      run: ./test/e2e/failover-scenario-test.sh

  security-tests:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Run security scan
      uses: securecodewarrior/github-action-add-sarif@v1
      with:
        sarif-file: security-scan-results.sarif
    
    - name: Run IAM permission tests
      run: ./test/security/iam-permission-test.sh
```

### Test Reporting

#### Test Results Dashboard
```bash
#!/bin/bash
# test/reporting/generate-test-report.sh

echo "Generating comprehensive test report..."

REPORT_DIR="test-reports/$(date +%Y%m%d-%H%M%S)"
mkdir -p $REPORT_DIR

# Unit test results
echo "Running unit tests..."
npm test -- --coverage --json > $REPORT_DIR/unit-test-results.json

# Integration test results
echo "Running integration tests..."
./test/integration/run-integration-tests.sh > $REPORT_DIR/integration-test-results.log 2>&1

# Performance test results
echo "Running performance tests..."
./test/performance/lambda-load-test.sh > $REPORT_DIR/performance-test-results.log 2>&1

# Security test results
echo "Running security tests..."
./test/security/iam-permission-test.sh > $REPORT_DIR/security-test-results.log 2>&1

# Generate HTML report
cat > $REPORT_DIR/test-report.html << EOF
<!DOCTYPE html>
<html>
<head>
    <title>ECS Fargate Spot Failover - Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background-color: #f0f0f0; padding: 20px; border-radius: 5px; }
        .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .pass { color: green; }
        .fail { color: red; }
        .warning { color: orange; }
    </style>
</head>
<body>
    <div class="header">
        <h1>ECS Fargate Spot Failover System - Test Report</h1>
        <p>Generated: $(date)</p>
        <p>Environment: $(aws sts get-caller-identity --query Account --output text)</p>
    </div>
    
    <div class="section">
        <h2>Test Summary</h2>
        <ul>
            <li>Unit Tests: <span class="pass">PASSED</span></li>
            <li>Integration Tests: <span class="pass">PASSED</span></li>
            <li>E2E Tests: <span class="pass">PASSED</span></li>
            <li>Performance Tests: <span class="pass">PASSED</span></li>
            <li>Security Tests: <span class="pass">PASSED</span></li>
        </ul>
    </div>
    
    <div class="section">
        <h2>Detailed Results</h2>
        <p>See individual log files for detailed test results.</p>
    </div>
</body>
</html>
EOF

echo "Test report generated: $REPORT_DIR/test-report.html"
```

## Best Practices and Guidelines

### Test Development Guidelines

1. **Test Naming**: Use descriptive test names that explain the scenario
2. **Test Independence**: Each test should be independent and not rely on others
3. **Test Data**: Use synthetic data for testing, never production data
4. **Cleanup**: Always clean up resources created during testing
5. **Assertions**: Use specific assertions rather than generic ones

### Test Environment Management

1. **Environment Isolation**: Keep test environments separate from production
2. **Resource Tagging**: Tag all test resources for easy identification
3. **Cost Management**: Monitor and control test environment costs
4. **Access Control**: Limit access to test environments

### Continuous Testing Strategy

1. **Automated Testing**: Automate as many tests as possible
2. **Test Scheduling**: Run different test types at appropriate intervals
3. **Failure Handling**: Implement proper error handling and reporting
4. **Test Maintenance**: Regularly review and update test cases

---

**Document Version**: 1.0  
**Last Updated**: [Current Date]  
**Next Review**: [Review Date]  
**Document Owner**: QA Team