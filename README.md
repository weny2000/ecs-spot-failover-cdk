# ECS Fargate Spot Instance Automatic Failover Solution

## Project Overview

This project implements a fully automated Serverless architecture for monitoring the health status of ECS Fargate Spot instances and automatically switching to standard Fargate instances during consecutive failures. When AWS regions experience failures, Spot resource pools are exhausted, or other reasons cause consecutive Fargate Spot instance startup failures, the system automatically switches workloads to more reliable standard Fargate instances, ensuring high availability of services.

## Core Features

- 🚀 **Fully Automated**: Fault detection and switching without manual intervention
- 💰 **Cost Optimization**: Prioritize Spot instances to maximize cost savings
- 🔄 **Intelligent Recovery**: Automatically switch back to cost-effective mode after Spot instances recover
- 📊 **Real-time Monitoring**: Complete event logs and status tracking
- 🔔 **Notification System**: Real-time notifications for critical events
- ⚡ **Fast Response**: Event-driven architecture based on EventBridge

## Architecture Components

### Core Services
- **Amazon ECS**: Run containerized applications
- **Amazon EventBridge**: Capture and route ECS events
- **AWS Lambda**: Implement core business logic
- **Amazon DynamoDB**: Store error counters and failover states
- **Amazon SNS**: Send system notifications

### Lambda Functions
- **Spot Error Detector**: Listen for Spot startup failure events, maintain error counters
- **Fargate Fallback Orchestrator**: Execute failover, start standard Fargate services
- **Spot Success Monitor**: Listen for Spot successful startup events, trigger recovery process
- **Cleanup Orchestrator**: Clean up backup environment, restore to Spot mode

## Quick Start

### 1. Prerequisites

- AWS CLI configured
- Node.js >= 16.x
- AWS CDK >= 2.x
- Required AWS permissions (ECS, Lambda, DynamoDB, EventBridge, SNS, IAM)

### 2. Installation and Deployment

```bash
# Clone the project
git clone <repository-url>
cd ecs-fargate-spot-failover

# Install dependencies
npm install

# Build the project
npm run build

# Deploy infrastructure
cdk deploy
```

### 3. Create Sample Services

```bash
# Get VPC information and create sample services
./scripts/create-sample-services.sh
```

### 4. Test the System

```bash
# Run failover test
./scripts/test-failover.sh

# Start system monitoring
./scripts/monitor-system.sh
```

## Workflow

### Normal Operation
1. **Spot services running normally** → Maximize cost efficiency
2. **Success Monitor resets counters** → Maintain healthy state

### Failover
1. **Spot instances fail consecutively** → EventBridge captures events
2. **Error Detector counts errors** → Trigger failover when threshold (3 times) is reached
3. **Failback Orchestrator executes switch** → Start standard Fargate services
4. **Seamless service switching** → Ensure business continuity

### Automatic Recovery
1. **Spot instances recover to normal** → Success Monitor detects success events
2. **Trigger cleanup process** → Cleanup Orchestrator executes recovery
3. **Switch back to Spot mode** → Resume cost-effective operation

## Configuration Parameters

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| `FAILURE_THRESHOLD` | 3 | Number of consecutive failures to trigger failover |
| `CLEANUP_DELAY` | 30 seconds | Time to wait for Spot instances to stabilize before cleanup |
| `SERVICE_STABLE_TIMEOUT` | 5 minutes | Timeout for waiting services to reach stable state |

## Monitoring and Notifications

### System Monitoring
```bash
# Real-time system status monitoring
./scripts/monitor-system.sh

# View specific service status
aws ecs describe-services --cluster fargate-spot-cluster --services sample-app
```

### Notification Configuration
```bash
# Add email notifications
aws sns subscribe \
  --topic-arn <NOTIFICATION_TOPIC_ARN> \
  --protocol email \
  --notification-endpoint your-email@example.com
```

## Cost Benefits

- **Spot Instance Savings**: Up to 70% compute cost reduction
- **On-demand Switching**: Use standard instances only when necessary
- **Automatic Recovery**: Maximize Spot instance usage time
- **Serverless Architecture**: Zero management overhead

## Documentation

### Core Documentation
- [Architecture Overview](docs/architecture-overview.md) - System architecture and component details
- [Deployment Guide](docs/deployment-guide.md) - Detailed deployment steps and configuration

### Operations Documentation
- [Execution Guide](docs/execution-guide.md) - Step-by-step system execution and operation procedures
- [Operations Manual](docs/operations-manual.md) - Daily operations, monitoring, and maintenance procedures
- [Release Guide](docs/release-guide.md) - Comprehensive release management and deployment strategies
- [Testing Guide](docs/testing-guide.md) - Complete testing procedures and validation strategies

### Examples and References
- [Sample Configuration](examples/) - ECS service configuration examples

## Troubleshooting

### Common Issues

1. **Insufficient Lambda Function Permissions**
   ```bash
   # Check IAM role permissions
   aws iam get-role --role-name <lambda-execution-role>
   ```

2. **EventBridge Rules Not Triggered**
   ```bash
   # Check event rule status
   aws events list-rules --name-prefix EcsFargateSpotFailover
   ```

3. **Service Creation Failed**
   ```bash
   # Check ECS cluster status
   aws ecs describe-clusters --clusters fargate-spot-cluster
   ```

### View Logs
```bash
# View Lambda function logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/EcsFargateSpotFailover"
```

## Clean Up Resources

```bash
# Stop sample services
aws ecs update-service --cluster fargate-spot-cluster --service sample-app --desired-count 0
aws ecs update-service --cluster fargate-spot-cluster --service sample-app-standard --desired-count 0

# Delete CDK stack
cdk destroy
```

## Contributing

Issues and Pull Requests are welcome to improve this project.
