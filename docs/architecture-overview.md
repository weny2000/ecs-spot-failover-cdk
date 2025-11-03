# ECS Fargate Spot Failover System Architecture Overview

## Background

In large-scale IoT data processing systems, the backend continuously analyzes incoming files in real time. To sustain high throughput, it often runs up to 200 concurrent ECS tasks for parallel analytics. Because these workloads are long-running and highly parallel, optimizing operational costs becomes crucial.

To reduce overall compute expenses, the system primarily utilizes Fargate Spot capacity providers for task execution. However, Spot resources may occasionally experience capacity shortages or AWS-side disruptions, resulting in failed task placements or prolonged Pending states.

This architecture introduces an automated fallback mechanism that ensures system stability and cost-efficiency simultaneously.

## System Overview

This system implements a fully automated Serverless architecture for monitoring the health status of ECS Fargate Spot instances and automatically switching to standard Fargate instances during consecutive failures, ensuring high availability of services.

## Architecture Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   ECS Cluster   │    │   EventBridge    │    │ Lambda Functions│
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ Spot Service│ │───▶│ │ Task State   │ │───▶│ │ Error       │ │
│ │             │ │    │ │ Change Rule  │ │    │ │ Detector    │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
│                 │    │                  │    │        │        │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │        ▼        │
│ │ Standard    │ │    │ │ Task Running │ │    │ ┌─────────────┐ │
│ │ Service     │ │    │ │ Rule         │ │    │ │ Failover    │ │
│ │ (Backup)    │ │    │ └──────────────┘ │    │ │ Orchestrator│ │
│ └─────────────┘ │    └──────────────────┘    │ └─────────────┘ │
└─────────────────┘                            │        │        │
                                               │        ▼        │
┌─────────────────┐    ┌──────────────────┐    │ ┌─────────────┐ │
│   DynamoDB      │    │      SNS         │    │ │ Success     │ │
│                 │    │                  │    │ │ Monitor     │ │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ └─────────────┘ │
│ │ Error       │ │◀───│ │ Notification │ │◀───│        │        │
│ │ Counter     │ │    │ │ Topic        │ │    │        ▼        │
│ │ Table       │ │    │ └──────────────┘ │    │ ┌─────────────┐ │
│ └─────────────┘ │    └──────────────────┘    │ │ Cleanup     │ │
│                 │                            │ │ Orchestrator│ │
│ ┌─────────────┐ │                            │ └─────────────┘ │
│ │ Failover    │ │                            └─────────────────┘
│ │ State       │ │
│ └─────────────┘ │
└─────────────────┘
```

## Core Components

### 1. Amazon ECS (Elastic Container Service)

**Purpose**: Run containerized applications

**Configuration**:

- **Spot Service**: Uses `FARGATE_SPOT` capacity provider, cost-effective
- **Standard Service**: Uses `FARGATE` capacity provider, serves as backup, initial desired task count is 0

**Key Features**:

- Supports capacity provider strategies
- Automatic task scheduling and health checks
- Integrates with EventBridge to send task state change events

### 2. Amazon EventBridge

**Purpose**: Capture and route ECS events

**Event Rules**:

1. **Task State Change Rule**: Listen for task stop events

   ```json
   {
     "source": ["aws.ecs"],
     "detail-type": ["ECS Task State Change"],
     "detail": {
       "lastStatus": ["STOPPED"],
       "stoppedReason": [
         {"prefix": "Task stopped due to"},
         {"prefix": "ResourcesNotAvailable"},
         {"prefix": "SpotInterruption"}
       ]
     }
   }
   ```

2. **Task Running Rule**: Listen for task successful startup events

   ```json
   {
     "source": ["aws.ecs"],
     "detail-type": ["ECS Task State Change"],
     "detail": {
       "lastStatus": ["RUNNING"]
     }
   }
   ```

### 3. AWS Lambda Functions

#### 3.1 Spot Error Detector

**Trigger Condition**: ECS task stop events

**Main Functions**:

- Identify Spot-related errors
- Update error counter in DynamoDB
- Trigger failover when threshold is reached

**Error Identification Patterns**:

- `ResourcesNotAvailable`: Insufficient Spot capacity
- `SpotInterruption`: Spot instance interrupted
- `Task stopped due to`: Task abnormal termination

#### 3.2 Fargate Failback Orchestrator

**Trigger Condition**: Error count reaches threshold (default 3 times)

**Main Functions**:

- Start standard Fargate service
- Stop Spot service
- Record failover state
- Send notifications

**Execution Flow**:

1. Get desired task count of Spot service
2. Set standard service desired task count to the same value
3. Set Spot service desired task count to 0
4. Record failover state in DynamoDB

#### 3.3 Spot Success Monitor

**Trigger Condition**: ECS task successful startup events

**Main Functions**:

- Reset error counter
- Check failover state
- Trigger cleanup process

**Decision Logic**:

- Identify successful Spot task startup
- Check if active failover state exists
- If exists, trigger cleanup orchestrator

#### 3.4 Cleanup Orchestrator

**Trigger Condition**: Spot instances recover to normal and active failover exists

**Main Functions**:

- Restore Spot service
- Stop standard service
- Clear failover state

**Execution Flow**:

1. Wait for Spot instances to run stably (30 seconds)
2. Restore Spot service to original desired task count
3. Wait for Spot service to reach stable state
4. Set standard service desired task count to 0
5. Clear failover state in DynamoDB

### 4. Amazon DynamoDB

**Purpose**: Store system state information

**Table Structure**:

```json
{
  "service_name": "string",           // Partition key
  "error_count": "number",            // Error count
  "last_error_time": "string",        // Last error time
  "last_success_time": "string",      // Last success time
  "failover_state": {                 // Failover state
    "failover_active": "boolean",
    "failover_time": "string",
    "original_desired_count": "number",
    "spot_service": "string",
    "standard_service": "string"
  },
  "cleanup_time": "string"            // Cleanup time
}
```

### 5. Amazon SNS (Simple Notification Service)

**Purpose**: Send system notifications

**Notification Scenarios**:

- Spot instance error detection
- Failover execution
- Spot instance recovery
- Environment cleanup completion
- Operation failure warnings

## Workflow

### Normal Operation Flow

1. **Spot Service Running Normally**
   - Tasks start and run successfully
   - Success Monitor resets error counter
   - System maintains cost-effective mode

### Failover Flow

1. **Spot Instance Failure**
   - ECS tasks stop due to Spot-related reasons
   - EventBridge captures task state change events

2. **Error Detection and Counting**
   - Error Detector identifies Spot-related errors
   - Updates error counter in DynamoDB
   - Sends error notifications

3. **Trigger Failover** (after 3 consecutive failures)
   - Error Detector triggers Failback Orchestrator
   - Start standard Fargate service
   - Stop Spot service
   - Record failover state

4. **Service Switch Complete**
   - Standard Fargate service takes over workload
   - Send failover completion notification

### Recovery Flow

1. **Spot Instance Recovery**
   - Spot tasks start successfully
   - Success Monitor detects success events

2. **Trigger Cleanup**
   - Check failover state
   - Trigger Cleanup Orchestrator

3. **Environment Cleanup**
   - Restore Spot service
   - Stop standard service
   - Clear failover state
   - Send cleanup completion notification

## Configuration Parameters

### Adjustable Parameters

- **FAILURE_THRESHOLD**: Failure count threshold to trigger failover (default: 3)
- **CLEANUP_DELAY**: Wait time before cleanup (default: 30 seconds)
- **SERVICE_STABLE_TIMEOUT**: Timeout for waiting service to stabilize (default: 5 minutes)

### Monitoring Metrics

- Error counter values
- Failover frequency
- Service recovery time
- Cost savings ratio

## Security Considerations

### IAM Permissions

Lambda functions use principle of least privilege:

- ECS: `UpdateService`, `DescribeServices`, `DescribeTasks`, `ListTasks`
- DynamoDB: `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem` for specific tables
- SNS: `Publish` for specific topics

### Network Security

- VPC internal communication
- Security groups control access
- Private subnet deployment (optional)

## Cost Optimization

### Cost Savings

- Spot instances can save up to 70% of compute costs
- Use standard instances only when necessary
- Automatically recover to cost-effective mode

### Resource Optimization

- On-demand scaling
- Serverless architecture reduces management overhead
- Event-driven response mechanism


## Summary

Plan provides a hybrid Spot + On-Demand architecture that ensures real-time IoT analytics systems remain stable during Spot shortages while achieving up to 50% cost reduction through intelligent fallback automation.
