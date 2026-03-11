# 🚀 ECS Fargate Spot Automatic Failover Solution



A fully automated serverless architecture solution for monitoring ECS Fargate Spot instance health and automatically switching to standard Fargate instances during consecutive failures.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![AWS CDK](https://img.shields.io/badge/AWS-CDK-orange.svg)](https://aws.amazon.com/cdk/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9+-blue.svg)](https://www.typescriptlang.org/)

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Features](#-features)
- [Quick Start](#-quick-start)
- [Deployment Options](#-deployment-options)
- [How It Works](#-how-it-works)
- [Monitoring & Alerts](#-monitoring--alerts)
- [Cost Analysis](#-cost-analysis)
- [Troubleshooting](#-troubleshooting)
- [Cleanup](#-cleanup)
- [Contributing](#-contributing)

## 🎯 Overview

When AWS regions experience failures, Spot resource pools are exhausted, or other reasons cause consecutive Fargate Spot instance startup failures, the system automatically switches workloads to more reliable standard Fargate instances, ensuring high availability of services.

### Use Cases

- Cost-sensitive production environments
- Workloads tolerant of brief interruptions
- Batch processing and background jobs
- Development and testing environments
- Stateless applications requiring auto-recovery

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User Requests                                    │
│                                 │                                           │
│                                 ▼                                           │
│                    ┌──────────────────────┐                                │
│                    │  Application Load    │                                │
│                    │     Balancer         │                                │
│                    └──────────┬───────────┘                                │
│                               │                                             │
│           ┌───────────────────┴───────────────────┐                        │
│           │                                       │                        │
│           ▼                                       ▼                        │
│  ┌─────────────────┐                    ┌─────────────────┐                │
│  │  Fargate Spot   │    On Failure      │  Fargate        │                │
│  │  (sample-app)   │◄──────────────────►│  (sample-app-   │                │
│  │  • Cost Opt     │    Auto Switch     │   standard)     │                │
│  │  • Replicas: 2  │                    │  • High Rel     │                │
│  └─────────────────┘                    │  • Initial: 0   │                │
│           │                              └─────────────────┘                │
│           │                                                                 │
│           │  Task State Change Events                                       │
│           ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │                    EventBridge                               │           │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │           │
│  │  │ STOPPED     │  │ RUNNING     │  │ Event Rules          │  │           │
│  │  │ (Error)     │  │ (Success)   │  │                      │  │           │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────────────┘  │           │
│  └─────────┼────────────────┼──────────────────────────────────┘           │
│            │                │                                              │
│            ▼                ▼                                              │
│  ┌─────────────────┐  ┌─────────────────┐                                 │
│  │ Spot Error      │  │ Spot Success    │                                 │
│  │ Detector        │  │ Monitor         │                                 │
│  │ Lambda          │  │ Lambda          │                                 │
│  └────────┬────────┘  └────────┬────────┘                                 │
│           │                    │                                          │
│           ▼                    ▼                                          │
│  ┌─────────────────┐  ┌─────────────────┐                                 │
│  │ DynamoDB        │  │ Cleanup         │                                 │
│  │ (Counter)       │  │ Orchestrator    │                                 │
│  └─────────────────┘  │ Lambda          │                                 │
│                       └─────────────────┘                                 │
│            │                                                              │
│            ▼                                                              │
│  ┌─────────────────┐                                                      │
│  │ Failback        │                                                      │
│  │ Orchestrator    │                                                      │
│  │ Lambda          │                                                      │
│  └─────────────────┘                                                      │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────┐         │
│  │ SNS Topic (Notifications)                                    │         │
│  │  • Email  • Slack  • SMS                                     │         │
│  └─────────────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🚀 **Fully Automated** | Fault detection and switching without manual intervention |
| 💰 **Cost Optimized** | Prioritize Spot instances, save up to 70% on costs |
| 🔄 **Intelligent Recovery** | Auto-switch back to cost-effective mode after Spot recovery |
| 📊 **Real-time Monitoring** | Complete event logs and status tracking |
| 🔔 **Alert Notifications** | Real-time notifications for critical events |
| ⚡ **Fast Response** | Event-driven architecture based on EventBridge |
| 🏗️ **One-Click Deploy** | Complete infrastructure as code with CDK |

## 🚀 Quick Start

### Prerequisites

- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) configured
- [Node.js](https://nodejs.org/) >= 18.x
- [AWS CDK](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) >= 2.x
- Required AWS permissions:
  - ECS, Lambda, DynamoDB, EventBridge, SNS, IAM, CloudWatch Logs, ELB

### 1. Install & Deploy

```bash
# Clone the repository
git clone https://github.com/yourusername/ecs-fargate-spot-failover.git
cd ecs-fargate-spot-failover

# Install dependencies
npm install

# Deploy full infrastructure (including sample app)
npm run deploy
```

### 2. Access Sample Application

After deployment, the output will show the load balancer DNS:

```bash
# Get application URL
aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text
```

Access in browser: `http://<LoadBalancerDNS>`

### 3. Configure Alerts (Optional)

```bash
# Add email subscription
aws sns subscribe \
  --topic-arn $(aws cloudformation describe-stacks \
    --stack-name EcsFargateSpotFailoverStack \
    --query 'Stacks[0].Outputs[?OutputKey==`NotificationTopicArn`].OutputValue' \
    --output text) \
  --protocol email \
  --notification-endpoint your-email@example.com
```

## 🔧 Deployment Options

### Full Deployment (Recommended)

Deploy complete solution including sample app, load balancer, and monitoring:

```bash
# Default deployment (2 Spot replicas)
npm run deploy

# Custom replica count
npm run deploy -- -c sampleAppDesiredCount=4

# Custom app port
npm run deploy -- -c appPort=8080
```

### Minimal Deployment

Deploy failover mechanism only, without sample app (for existing ECS services):

```bash
npm run deploy:minimal
```

### Step-by-Step Deployment

```bash
# 1. Compile TypeScript
npm run build

# 2. View changes
npm run diff

# 3. Synthesize CloudFormation template
npm run synth

# 4. Deploy
npm run deploy
```

## 🔄 How It Works

### Normal Operation

```
User Request → ALB → Fargate Spot (sample-app: 2 replicas)
                              ↓
                    Spot Success Monitor (Success Events)
                              ↓
                    Reset Error Counter → Healthy State
```

### Failover Flow

```
1. Spot instances fail consecutively (>=3 times)
           ↓
2. EventBridge captures STOPPED events
           ↓
3. Spot Error Detector increments error count
           ↓
4. Threshold reached → Trigger Failback Orchestrator
           ↓
5. Start standard Fargate (sample-app-standard: 2 replicas)
           ↓
6. Stop Spot service (sample-app: 0 replicas)
           ↓
7. ALB automatically switches traffic to standard service
           ↓
8. Send alert notification
```

### Auto-Recovery Flow

```
1. Spot instances recover
           ↓
2. Spot Success Monitor detects RUNNING events
           ↓
3. Trigger Cleanup Orchestrator
           ↓
4. Start Spot service (sample-app: 2 replicas)
           ↓
5. Wait for Spot service stabilization
           ↓
6. Stop standard service (sample-app-standard: 0 replicas)
           ↓
7. ALB switches traffic back to Spot service
           ↓
8. Send recovery notification
```

## 📊 Monitoring & Alerts

### CloudWatch Logs

```bash
# View Spot service logs
aws logs tail /ecs/fargate-spot-sample-app --follow --filter-pattern "spot-service"

# View standard service logs
aws logs tail /ecs/fargate-spot-sample-app --follow --filter-pattern "standard-service"

# View Lambda function logs
aws logs tail /aws/lambda/EcsFargateSpotFailoverStack-SpotErrorDetector --follow
```

### DynamoDB Status Query

```bash
# View error counter
aws dynamodb get-item \
  --table-name fargate-spot-error-counter \
  --key '{"service_name": {"S": "sample-app"}}'
```

### Service Status Check

```bash
# Check Spot service status
aws ecs describe-services \
  --cluster fargate-spot-cluster \
  --services sample-app

# Check standard service status
aws ecs describe-services \
  --cluster fargate-spot-cluster \
  --services sample-app-standard
```

## 💰 Cost Analysis

| Resource Type | Price Estimate | Notes |
|--------------|----------------|-------|
| Fargate Spot | $0.01232/vCPU/hour | ~70% savings vs standard Fargate |
| Fargate Standard | $0.04048/vCPU/hour | Used during failover |
| Application Load Balancer | ~$0.0225/hour | LCU charges apply |
| Lambda | Within free tier | Event-driven, minimal invocations |
| DynamoDB | Within free tier | On-demand billing |
| SNS | Within free tier | Alert notifications |

**Monthly Cost Estimate (2 vCPU config):**

- All Spot: ~$18/month
- All Standard: ~$60/month
- Hybrid (90% Spot): ~$22/month

## 🛠️ Troubleshooting

### Common Issues

#### 1. Lambda Permission Issues

```bash
# Check IAM role permissions
aws iam get-role --role-name EcsFargateSpotFailoverStack-LambdaExecutionRole
```

#### 2. EventBridge Rules Not Triggering

```bash
# Check event rule status
aws events list-rules --name-prefix EcsFargateSpotFailoverStack

# View CloudTrail events
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=PutRule
```

#### 3. Service Creation Failed

```bash
# Check ECS cluster status
aws ecs describe-clusters --clusters fargate-spot-cluster

# View service events
aws ecs describe-services \
  --cluster fargate-spot-cluster \
  --services sample-app \
  --query 'services[0].events[:5]'
```

#### 4. Failover Not Triggered

Check error counter in DynamoDB:

```bash
aws dynamodb scan --table-name fargate-spot-error-counter
```

### Debug Logs

```bash
# View all Lambda log groups
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/EcsFargateSpotFailoverStack"

# Real-time monitoring of all logs
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-SpotErrorDetector" --follow &
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-FargateFailbackOrchestrator" --follow &
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-SpotSuccessMonitor" --follow &
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-CleanupOrchestrator" --follow &
```

## 🧹 Cleanup

```bash
# Method 1: Use CDK destroy
npm run destroy

# Method 2: Manually stop services before destroying
aws ecs update-service \
  --cluster fargate-spot-cluster \
  --service sample-app \
  --desired-count 0

aws ecs update-service \
  --cluster fargate-spot-cluster \
  --service sample-app-standard \
  --desired-count 0

# Wait for services to stop, then
cdk destroy
```

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Architecture Overview](docs/architecture-overview.md) | System architecture and component details |
| [Deployment Guide](docs/deployment-guide.md) | Detailed deployment steps and configuration |
| [Execution Guide](docs/execution-guide.md) | System execution and operation procedures |
| [Operations Manual](docs/operations-manual.md) | Daily operations, monitoring, and maintenance |
| [Release Guide](docs/release-guide.md) | Release management and deployment strategies |
| [Testing Guide](docs/testing-guide.md) | Testing procedures and validation strategies |

## 🤝 Contributing

Issues and Pull Requests are welcome!

### Development Workflow

```bash
# 1. Fork and clone
git clone https://github.com/yourusername/ecs-fargate-spot-failover.git

# 2. Create feature branch
git checkout -b feature/your-feature

# 3. Install deps and build
npm install
npm run build

# 4. Run tests
npm test

# 5. Commit changes
git commit -m "feat: add your feature"

# 6. Push and create PR
git push origin feature/your-feature
```

## 📄 License

This project is open-sourced under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- [AWS CDK](https://github.com/aws/aws-cdk) - Infrastructure as Code framework
- [AWS Fargate](https://aws.amazon.com/fargate/) - Serverless container compute

---

**Disclaimer**: This project is for learning and reference purposes only. Please test thoroughly before deploying to production.
