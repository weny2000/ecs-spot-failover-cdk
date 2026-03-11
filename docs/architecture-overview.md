# Architecture Overview

> 💡 **Editable Architecture Diagrams**: We provide architecture diagrams in multiple formats in the [`docs/architecture/`](../docs/architecture/) directory, supporting Draw.io, PlantUML, and Mermaid for easy viewing and editing.

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                      AWS Cloud                                           │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                              VPC (10.0.0.0/16)                                   │    │
│  │                                                                                  │    │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐    │    │
│  │  │                        Public Subnets (NLB)                              │    │    │
│  │  │  ┌─────────────────┐                                                    │    │    │
│  │  │  │   NLB (TCP)     |<<────────────────── User Traffic                    │    │    │
│  │  │  │   Port: 80      |                                                    │    │    │
│  │  │  └────────┬────────┘                                                    │    │    │
│  │  └───────────┼─────────────────────────────────────────────────────────────┘    │    │
│  │              │                                                                   │    │
│  │  ┌───────────┴─────────────────────────────────────────────────────────────┐    │    │
│  │  │                      Private Subnets (ECS Tasks)                         │    │    │
│  │  │                                                                          │    │    │
│  │  │   ┌─────────────────────┐         ┌─────────────────────┐               │    │    │
│  │  │   │   Fargate Spot      │         │   Fargate Standard  │               │    │    │
│  │  │   │   (Primary)         │         │   (Backup)          │               │    │    │
│  │  │   │                     │         │                     │               │    │    │
│  │  │   │  ┌───────────────┐  │         │  ┌───────────────┐  │               │    │    │
│  │  │   │  │   Nginx       │  │         │  │   Nginx       │  │               │    │    │
│  │  │   │  │   Container   │  │         │  │   Container   │  │               │    │    │
│  │  │   │  └───────────────┘  │         │  └───────────────┘  │               │    │    │
│  │  │   │                     │         │                     │               │    │    │
│  │  │   │  Replicas: 2        │<<───────>>│  Replicas: 0→2      │               │    │    │
│  │  │   │  Capacity: SPOT     │  Failover│  Capacity: ON_DEMAND│               │    │    │
│  │  │   │                     │         │                     │               │    │    │
│  │  │   │  Service: sample-app│         │  Service: sample-   │               │    │    │
│  │  │   │                     │         │         app-standard│               │    │    │
│  │  │   └─────────────────────┘         └─────────────────────┘               │    │    │
│  │  │                                                                          │    │    │
│  │  └──────────────────────────────────────────────────────────────────────────┘    │    │
│  │                                                                                  │    │
│  └──────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐    │
│  │                              Serverless Components                                │    │
│  │                                                                                  │    │
│  │   ┌─────────────────────┐                                                       │    │
│  │   │    EventBridge      │                                                       │    │
│  │   │                     │                                                       │    │
│  │   │  ECS Task State     │──────>> STOPPED events  ──────┐                       │    │
│  │   │  Change Events      │                              │                       │    │
│  │   │                     │──────>> RUNNING events ───────┤                       │    │
│  │   └─────────────────────┘                              │                       │    │
│  │                                                        ▼                       │    │
│  │   ┌─────────────────────┐                    ┌─────────────────┐               │    │
│  │   │  Spot Error         │                    │  Spot Success   │               │    │
│  │   │  Detector Lambda    │                    │  Monitor Lambda │               │    │
│  │   │                     │                    │                 │               │    │
│  │   │  • Detect Spot Error│                    │  • Detect Success│              │    │
│  │   │  • Maintain Counter │                    │  • Trigger Recovery              │    │
│  │   │  • Trigger Failover │                    │                 │               │    │
│  │   └──────────┬──────────┘                    └────────┬────────┘               │    │
│  │              │                                        │                        │    │
│  │              ▼                                        ▼                        │    │
│  │   ┌─────────────────────┐                    ┌─────────────────┐               │    │
│  │   │  DynamoDB           │                    │  Cleanup        │               │    │
│  │   │  Error Counter      │                    │  Orchestrator   │               │    │
│  │   │                     │                    │  Lambda         │               │    │
│  │   │  • error_count      │                    │                 │               │    │
│  │   │  • failover_state   │                    │  • Restore Spot │               │    │
│  │   │  • cleanup_state    │                    │  • Cleanup Std  │               │    │
│  │   └─────────────────────┘                    └─────────────────┘               │    │
│  │                                                        │                        │    │
│  │   ┌─────────────────────┐                    ┌────────▼────────┐               │    │
│  │   │  Failback           │<<───────────────────┘                 │               │    │
│  │   │  Orchestrator       │         Lambda Invocation            │               │    │
│  │   │  Lambda             │                                    │               │    │
│  │   │                     │                                    │               │    │
│  │   │  • Start Standard   │                                    │               │    │
│  │   │  • Stop Spot        │                                    │               │    │
│  │   │  • Update State     │                                    │               │    │
│  │   └─────────────────────┘                                    │               │    │
│  │                                                               │               │    │
│  └───────────────────────────────────────────────────────────────┼───────────────┘    │
│                                                                  │                    │
│  ┌───────────────────────────────────────────────────────────────┼───────────────┐    │
│  │                      SNS Topic                               │               │    │
│  │                                                              │               │    │
│  │   • Spot Error Alert  <<─────────────────────────────────────┼───────────────┤    │
│  │   • Failover Notice   <<─────────────────────────────────────┼───────────────┤    │
│  │   • Recovery Notice   <<─────────────────────────────────────┘               │    │
│  │                                                                              │    │
│  │   Subscriptions: Email / SMS / Slack / Lambda                               │    │
│  │                                                                              │    │
│  └──────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Component Descriptions

### 1. Network Layer (VPC)

| Component | Description |
|-----------|-------------|
| VPC | 10.0.0.0/16 CIDR, 2 Availability Zones |
| Public Subnets | Used to deploy Network Load Balancer |
| Private Subnets | Used to deploy ECS Fargate tasks |
| NAT Gateway | Allows tasks in private subnets to access the internet |

### 2. Compute Layer (ECS)

#### Fargate Spot Service (Primary)
- **Service Name**: sample-app
- **Capacity Provider**: FARGATE_SPOT
- **Initial Replica Count**: 2
- **Cost**: Saves approximately 70% compared to standard Fargate

#### Fargate Standard Service (Backup)
- **Service Name**: sample-app-standard
- **Capacity Provider**: FARGATE
- **Initial Replica Count**: 0 (automatically starts during failover)
- **Purpose**: High-availability backup

### 3. Load Balancer Layer (NLB)

```
User Request -> NLB -> Target Group (Spot) -> Fargate Spot Tasks
                          |
                    Failover Switch
                          |
                     Target Group (Standard) -> Fargate Standard Tasks
```

### 4. Control Layer (Lambda + EventBridge)

#### Spot Error Detector
- **Trigger**: EventBridge (ECS Task STOPPED)
- **Responsibilities**:
  - Analyze task stop reason
  - Identify Spot-related errors
  - Maintain DynamoDB error counter
  - Trigger failover

#### Fargate Failback Orchestrator
- **Trigger Method**: Lambda Invoke (asynchronous)
- **Responsibilities**:
  - Start standard Fargate service
  - Wait for service to stabilize
  - Stop Spot service
  - Send notification

#### Spot Success Monitor
- **Trigger**: EventBridge (ECS Task RUNNING)
- **Responsibilities**:
  - Detect Spot task successful start
  - Check failover state
  - Trigger recovery process

#### Cleanup Orchestrator
- **Trigger Method**: Lambda Invoke (asynchronous)
- **Responsibilities**:
  - Restore Spot service
  - Wait for Spot to stabilize
  - Stop standard service
  - Send recovery notification

### 5. Data Layer (DynamoDB)

**Table Name**: fargate-spot-error-counter

| Field Name | Type | Description |
|------------|------|-------------|
| service_name | String | Service Name (Partition Key) |
| error_count | Number | Consecutive Error Count |
| failover_state | Map | Failover State |
| last_error_time | String | Last Error Time |
| last_success_time | String | Last Success Time |
| cleanup_in_progress | Boolean | Cleanup In Progress |

### 6. Notification Layer (SNS)

**Notification Events**:
- Spot Error Detection
- Failover Triggered
- Failover Completed
- Recovery Process Completed
- System Error

## Data Flow

### Failover Data Flow

```
1. Spot Task Failed
   |
2. ECS sends STOPPED event to EventBridge
   |
3. EventBridge triggers Spot Error Detector Lambda
   |
4. Lambda checks error type
   |
   +-- Not Spot Error --> Ignore
   |
   +-- Is Spot Error
      |
5. Update DynamoDB (error_count + 1)
   |
6. Check threshold (>=3)
   |
   +-- Not reached --> Wait for next error
   |
   +-- Threshold reached
      |
7. Trigger Failback Orchestrator Lambda
   |
8. Start Standard Fargate (desiredCount: 0->2)
   |
9. Wait for service stable
   |
10. Stop Spot Service (desiredCount: 2->0)
    |
11. Update DynamoDB (failover_state)
    |
12. Send SNS Notification
```

### Recovery Data Flow

```
1. Spot Task Started Successfully
   |
2. ECS sends RUNNING event to EventBridge
   |
3. EventBridge triggers Spot Success Monitor Lambda
   |
4. Check failover_state
   |
   +-- No failover state --> Ignore
   |
   +-- Has failover state
      |
5. Check if recovery in progress
   |
   +-- Yes --> Ignore
   |
   +-- No
      |
6. Trigger Cleanup Orchestrator Lambda
   |
7. Start Spot Service (desiredCount: 0->2)
   |
8. Wait for Spot stable
   |
9. Stop Standard Service (desiredCount: 2->0)
   |
10. Update DynamoDB (clear failover_state)
    |
11. Send SNS Notification
```

## Security Design

### IAM Least Privilege

Each Lambda function has only the minimum necessary permissions:

- **ECS Access**: Only allow UpdateService, DescribeServices
- **DynamoDB Access**: Only allow Get/Put/Update for specific table
- **SNS Access**: Only allow Publish for specific Topic
- **Lambda Invoke**: Only allow Invoke for specific functions

### Network Security

- ECS tasks deployed in private subnets with no public IP
- Only NLB exposed to the internet
- Security groups only open necessary ports

### Data Security

- DynamoDB tables enable encryption
- Log retention policy (default 7 days)
- No sensitive data persistence

## Scalability Design

### Horizontal Scaling

- Support increasing replica count for Spot and Standard services
- NLB automatically handles traffic distribution
- DynamoDB on-demand mode auto-scales

### Multi-Service Support

Multiple applications can be supported by modifying service names:

```typescript
const services = ['api-service', 'web-service', 'worker-service'];

for (const serviceName of services) {
  // Create Spot + Standard service pair for each
  // Share same control plane (Lambda + DynamoDB)
}
```

### Custom Configuration

```typescript
new EcsFargateSpotFailoverStack(app, 'Stack', {
  sampleAppDesiredCount: 4,  // Custom replica count
  createSampleApp: true,      // Whether to create sample app
  appPort: 8080,              // Custom port
});
```

## Performance Considerations

### Failover Time

| Phase | Estimated Time |
|-------|----------------|
| Error Detection | < 1 second |
| Lambda Execution | 2-5 seconds |
| Standard Service Startup | 30-60 seconds |
| Spot Service Stop | 10-30 seconds |
| **Total** | **45-95 seconds** |

### Recovery Time

| Phase | Estimated Time |
|-------|----------------|
| Success Detection | < 1 second |
| Lambda Execution | 2-5 seconds |
| Spot Service Startup | 30-60 seconds |
| Standard Service Stop | 10-30 seconds |
| **Total** | **45-95 seconds** |

### Optimization Suggestions

1. **Health Check Configuration**: Adjust healthCheckGracePeriod to match application startup time
2. **Replica Count**: Adjust desiredCount based on load
3. **Threshold Adjustment**: Adjust FAILURE_THRESHOLD based on business tolerance
4. **Cleanup Delay**: Adjust CLEANUP_DELAY based on Spot stability
