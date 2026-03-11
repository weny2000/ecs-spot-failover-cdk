# 🚀 ECS Fargate Spot Automatic Failover Solution

[![CI](https://github.com/weny2000/ecs-spot-failover-cdk/actions/workflows/ci.yml/badge.svg)](https://github.com/weny2000/ecs-spot-failover-cdk/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/ecs-fargate-spot-failover.svg)](https://www.npmjs.com/package/ecs-fargate-spot-failover)

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

### 📖 Background Story

This project is the CDK TypeScript implementation of the solution described in the Qiita blog post **「Fargate Spot で月$42K が $21K になった話」** (How we reduced monthly costs from $42K to $21K with Fargate Spot). 

- **Blog Post (Japanese)**: [Fargate Spot で月$42K が $21K になった話](https://qiita.com/weny/items/your-blog-post-url)
- **Key Achievement**: Reduced monthly ECS costs by **50%** ($42K → $21K) using Fargate Spot with automatic failover

This CDK implementation upgrades the original Terraform + Python solution to a production-ready TypeScript infrastructure with added ALB integration, Step Functions orchestration, and enhanced observability.

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
│  │  │ STOPPED     │  │ RUNNING     │  │ Scheduled (1min)    │  │           │
│  │  │ (Error)     │  │ (Success)   │  │ PENDING Check       │  │           │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │           │
│  └─────────┼────────────────┼────────────────────┼─────────────┘           │
│            │                │                   │                          │
│            ▼                ▼                   ▼                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │
│  │ Spot Error      │  │ Spot Success    │  │ Pending Task    │            │
│  │ Detector        │  │ Monitor         │  │ Monitor         │            │
│  │ Lambda          │  │ Lambda          │  │ Lambda          │            │
│  │                 │  │                 │  │ (Proactive)     │            │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘            │
│           │                    │                    │                     │
│           ▼                    ▼                    ▼                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐           │
│  │ DynamoDB        │  │ Cleanup         │  │ DynamoDB        │           │
│  │ (Counter)       │  │ Orchestrator    │  │ (Counter)       │           │
│  └─────────────────┘  │ Lambda          │  │ (Error++)       │           │
│                       └─────────────────┘  └─────────────────┘           │
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
git clone https://github.com/weny2000/ecs-spot-failover-cdk.git
cd ecs-spot-failover-cdk

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

### Sample Application Endpoints

The sample application provides several useful endpoints:

| Endpoint | Description |
|----------|-------------|
| `/` | Application info |
| `/health` | Health check (used by ALB) |
| `/status` | Detailed container info |
| `/simulate-failure` | Trigger test failure |

Test the deployment:
```bash
# Get the Load Balancer DNS
export ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

# Test endpoints
curl http://$ALB_DNS/
curl http://$ALB_DNS/health
curl http://$ALB_DNS/status

# Simulate failure (container will restart)
curl -X POST http://$ALB_DNS/simulate-failure
```

### Using Your Own Application

To deploy your own application instead of the sample nginx app:

```bash
cd examples/sample-apps/nodejs

# Build and push to ECR
./build.sh v1.0.0 us-east-1 myapp

# Update CDK context to use your image
npm run deploy -- -c appImage=myapp:v1.0.0 -c appPort=8080
```

See [examples/sample-apps/nodejs/README.md](examples/sample-apps/nodejs/README.md) for detailed instructions.

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

### Proactive PENDING Task Monitoring

When Spot capacity is exhausted, tasks may remain in **PENDING** state indefinitely without generating STOPPED events. The **Pending Task Monitor** (runs every 1 minute) proactively detects this:

```
1. Scheduled scan every 1 minute
           ↓
2. List tasks in PENDING state
           ↓
3. Check if tasks stuck for > 5 minutes
           ↓
4. YES → Increment error counter
           ↓
5. If threshold reached → Trigger failover
           ↓
6. NO → Continue normal monitoring
```

This addresses the critical gap in pure event-driven monitoring and ensures rapid failover even when Spot capacity is completely unavailable.

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
| Fargate Spot | $0.02049/vCPU/hour (us-east-1) | ~70% savings vs standard Fargate |
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
| [Sample Applications](examples/sample-apps/README.md) | Ready-to-use sample apps (Node.js, Python, Go) with Docker configurations |

## 🔌 Using as a CDK Construct Library

This project is published as a reusable CDK Construct on npm. You can integrate it into your existing CDK projects:

```bash
npm install ecs-fargate-spot-failover-cdk
```

### Basic Usage

```typescript
import { FargateSpotFailoverConstruct } from 'ecs-fargate-spot-failover-cdk';

// Assuming you have existing ECS services
new FargateSpotFailoverConstruct(this, 'Failover', {
  cluster: myCluster,
  spotService: mySpotService,
  standardService: myStandardService,
  failureThreshold: 3,
  enableNotifications: true,
  notificationEmails: ['alerts@example.com'],
});
```

### Advanced Configuration

```typescript
new FargateSpotFailoverConstruct(this, 'Failover', {
  cluster: myCluster,
  spotService: mySpotService,
  standardService: myStandardService,
  failureThreshold: 5,
  enableNotifications: true,
  notificationEmails: ['ops@example.com'],
  enablePendingTaskMonitoring: true,  // Detect tasks stuck in PENDING
  pendingTaskCheckInterval: Duration.minutes(1),
  pendingTaskTimeout: Duration.minutes(5),
  enableTracing: true,  // X-Ray tracing
  cloudWatchNamespace: 'MyApp/FargateSpot',
});
```

See [Construct Hub](https://constructs.dev/packages/ecs-fargate-spot-failover-cdk) for full API documentation.

## 🤝 Contributing

Issues and Pull Requests are welcome!

### Development Workflow

```bash
# 1. Fork and clone
git clone https://github.com/weny2000/ecs-spot-failover-cdk.git

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
