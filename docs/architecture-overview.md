# 架构概述

> 💡 **可编辑架构图**: 我们在 [`docs/architecture/`](../docs/architecture/) 目录下提供了多种格式的架构图，支持 Draw.io、PlantUML 和 Mermaid，方便您查看和编辑。

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                      AWS Cloud                                           │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                              VPC (10.0.0.0/16)                                   │    │
│  │                                                                                  │    │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐    │    │
│  │  │                        Public Subnets (ALB)                              │    │    │
│  │  │  ┌─────────────────┐                                                    │    │    │
│  │  │  │   ALB (HTTP)    |<<────────────────── User Traffic                    │    │    │
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

## 组件说明

### 1. 网络层 (VPC)

| 组件 | 说明 |
|------|------|
| VPC | 10.0.0.0/16 CIDR，2个可用区 |
| Public Subnets | 用于部署 Application Load Balancer |
| Private Subnets | 用于部署 ECS Fargate 任务 |
| NAT Gateway | 允许私有子网中的任务访问互联网 |

### 2. 计算层 (ECS)

#### Fargate Spot 服务 (Primary)
- **服务名称**: sample-app
- **容量提供者**: FARGATE_SPOT
- **初始副本数**: 2
- **成本**: 比标准 Fargate 节省约 70%

#### Fargate Standard 服务 (Backup)
- **服务名称**: sample-app-standard
- **容量提供者**: FARGATE
- **初始副本数**: 0 (故障转移时自动启动)
- **用途**: 高可靠性备份

### 3. 负载均衡层 (ALB)

```
User Request -> ALB -> Target Group (Spot) -> Fargate Spot Tasks
                          |
                    Failover Switch
                          |
                     Target Group (Standard) -> Fargate Standard Tasks
```

### 4. 控制层 (Lambda + EventBridge)

#### Spot Error Detector
- **触发器**: EventBridge (ECS Task STOPPED)
- **职责**:
  - 分析任务停止原因
  - 识别 Spot 相关错误
  - 维护 DynamoDB 错误计数器
  - 触发故障转移

#### Fargate Failback Orchestrator
- **触发方式**: Lambda Invoke (异步)
- **职责**:
  - 启动标准 Fargate 服务
  - 等待服务稳定
  - 停止 Spot 服务
  - 发送通知

#### Spot Success Monitor
- **触发器**: EventBridge (ECS Task RUNNING)
- **职责**:
  - 检测 Spot 任务成功启动
  - 检查故障转移状态
  - 触发恢复流程

#### Cleanup Orchestrator
- **触发方式**: Lambda Invoke (异步)
- **职责**:
  - 恢复 Spot 服务
  - 等待 Spot 稳定
  - 停止标准服务
  - 发送恢复通知

### 5. 数据层 (DynamoDB)

**表名**: fargate-spot-error-counter

| 字段名 | 类型 | 说明 |
|--------|------|------|
| service_name | String | 服务名称 (Partition Key) |
| error_count | Number | 连续错误计数 |
| failover_state | Map | 故障转移状态 |
| last_error_time | String | 最后错误时间 |
| last_success_time | String | 最后成功时间 |
| cleanup_in_progress | Boolean | 清理是否进行中 |

### 6. 通知层 (SNS)

**通知事件**:
- Spot 错误检测
- 故障转移触发
- 故障转移完成
- 恢复流程完成
- 系统错误

## 数据流

### 故障转移数据流

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

### 恢复数据流

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

## 安全设计

### IAM 权限最小化

每个 Lambda 函数只拥有必要的最小权限:

- **ECS Access**: 仅允许 UpdateService, DescribeServices
- **DynamoDB Access**: 仅允许特定表的 Get/Put/Update
- **SNS Access**: 仅允许特定 Topic 的 Publish
- **Lambda Invoke**: 仅允许特定函数的 Invoke

### 网络安全

- ECS 任务部署在私有子网，无公网 IP
- 仅 ALB 暴露在互联网
- 安全组仅开放必要端口

### 数据安全

- DynamoDB 表启用加密
- 日志保留策略（默认 7 天）
- 无敏感数据持久化

## 扩展性设计

### 水平扩展

- 支持增加 Spot 和 Standard 服务的副本数
- ALB 自动处理流量分发
- DynamoDB on-demand 模式自动扩展

### 多服务支持

通过修改服务名称，可以支持多个应用：

```typescript
const services = ['api-service', 'web-service', 'worker-service'];

for (const serviceName of services) {
  // Create Spot + Standard service pair for each
  // Share same control plane (Lambda + DynamoDB)
}
```

### 自定义配置

```typescript
new EcsFargateSpotFailoverStack(app, 'Stack', {
  sampleAppDesiredCount: 4,  // Custom replica count
  createSampleApp: true,      // Whether to create sample app
  appPort: 8080,              // Custom port
});
```

## 性能考虑

### 故障转移时间

| 阶段 | 预计时间 |
|------|---------|
| 错误检测 | < 1 秒 |
| Lambda 执行 | 2-5 秒 |
| 标准服务启动 | 30-60 秒 |
| Spot 服务停止 | 10-30 秒 |
| **总计** | **45-95 秒** |

### 恢复时间

| 阶段 | 预计时间 |
|------|---------|
| 成功检测 | < 1 秒 |
| Lambda 执行 | 2-5 秒 |
| Spot 服务启动 | 30-60 秒 |
| 标准服务停止 | 10-30 秒 |
| **总计** | **45-95 秒** |

### 优化建议

1. **健康检查配置**: 调整 healthCheckGracePeriod 匹配应用启动时间
2. **副本数**: 根据负载调整 desiredCount
3. **阈值调整**: 根据业务容忍度调整 FAILURE_THRESHOLD
4. **清理延迟**: 根据 Spot 稳定性调整 CLEANUP_DELAY
