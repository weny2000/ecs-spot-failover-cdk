# 测试指南

本指南介绍如何对 ECS Fargate Spot Failover 解决方案进行测试。

## 目录

- [单元测试](#单元测试)
- [集成测试](#集成测试)
- [端到端测试](#端到端测试)
- [性能测试](#性能测试)
- [手动测试故障转移](#手动测试故障转移)

## 单元测试

### 运行测试

```bash
# 运行所有测试
npm test

# 运行单元测试
npm run test:unit

# 带覆盖率报告
npm run test:coverage

# 监视模式（开发时使用）
npm run test:watch
```

### 测试结构

```
test/
├── setup.ts                    # Jest 全局设置
├── __mocks__/                  # Mock 函数
│   └── aws-sdk-client-mock.ts
└── unit/
    ├── lambda/                 # Lambda 函数测试
    │   ├── cleanup-orchestrator.test.ts
    │   ├── fargate-failback-orchestrator.test.ts
    │   ├── spot-error-detector.test.ts
    │   └── spot-success-monitor.test.ts
    └── stacks/                 # CDK 堆栈测试
        └── ecs-fargate-spot-failover-stack.test.ts
```

### Lambda 函数测试覆盖

#### Spot Error Detector

测试场景：
- ✅ 事件验证（无 detail、非 STOPPED 状态、非 Spot 错误）
- ✅ 错误检测（SpotInterruption、ResourcesNotAvailable、insufficient capacity）
- ✅ 错误计数递增
- ✅ 服务名称提取
- ✅ 故障转移触发（达到阈值、已活跃、未达阈值）
- ✅ 错误处理

#### Fargate Failback Orchestrator

测试场景：
- ✅ 事件解析（直接调用、EventBridge 格式、环境变量回退）
- ✅ 跳过条件（故障转移已活跃）
- ✅ 故障转移执行：
  - 启动标准服务
  - 停止 Spot 服务
  - 更新 DynamoDB 状态
  - 重置错误计数
  - 发送通知
- ✅ 错误处理

#### Cleanup Orchestrator

测试场景：
- ✅ 事件解析
- ✅ 跳过条件（无故障转移状态、故障转移未活跃）
- ✅ 清理延迟
- ✅ 恢复执行：
  - 恢复 Spot 服务
  - 停止标准服务
  - 更新 DynamoDB
  - 重置错误计数
  - 发送通知
- ✅ 超时处理
- ✅ 错误处理

#### Spot Success Monitor

测试场景：
- ✅ 事件验证
- ✅ Spot 任务检测（容量提供者、组名）
- ✅ 错误计数重置
- ✅ 恢复触发（活跃、进行中、未活跃）
- ✅ 服务名称提取
- ✅ 错误处理

### CDK 堆栈测试

测试内容：
- ✅ VPC 配置（CIDR、子网、NAT Gateway）
- ✅ ECS 集群（容量提供者）
- ✅ DynamoDB 表（Schema、计费模式）
- ✅ SNS Topic
- ✅ Lambda 函数（配置、环境变量）
- ✅ IAM 角色（权限策略）
- ✅ EventBridge 规则（事件模式、目标）
- ✅ ECS 服务（任务定义、容量策略）
- ✅ ALB（监听器、目标组）
- ✅ 配置选项（createSampleApp、desiredCount、appPort）

## 集成测试

### 前置条件

```bash
# 部署测试环境
npm run deploy

# 获取输出
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

### 测试 DynamoDB 集成

```bash
# 插入测试数据
aws dynamodb put-item \
  --table-name fargate-spot-error-counter \
  --item '{
    "service_name": {"S": "test-service"},
    "error_count": {"N": "0"},
    "failover_state": {"M": {"failover_active": {"BOOL": false}}}
  }'

# 查询数据
aws dynamodb get-item \
  --table-name fargate-spot-error-counter \
  --key '{"service_name": {"S": "test-service"}}'

# 删除测试数据
aws dynamodb delete-item \
  --table-name fargate-spot-error-counter \
  --key '{"service_name": {"S": "test-service"}}'
```

### 测试 Lambda 集成

```bash
# 获取 Lambda 函数名
DETECTOR_NAME=$(aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `SpotErrorDetector`)].FunctionName' \
  --output text)

# 测试事件
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

### 测试 SNS 集成

```bash
# 获取 Topic ARN
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`NotificationTopicArn`].OutputValue' \
  --output text)

# 发布测试消息
aws sns publish \
  --topic-arn $TOPIC_ARN \
  --subject "Test Notification" \
  --message "This is a test message"
```

## 端到端测试

### 完整故障转移测试

```bash
#!/bin/bash
# test-failover.sh

echo "=== Starting Failover Test ==="

# 1. 确认初始状态
echo "Checking initial state..."
aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SPOT_SERVICE $STANDARD_SERVICE

# 2. 手动触发 Spot 服务错误（通过停止任务）
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

# 3. 等待故障转移
echo "Waiting for failover..."
sleep 120

# 4. 验证标准服务已启动
echo "Verifying standard service is running..."
aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --service-name $STANDARD_SERVICE

# 5. 恢复 Spot 服务
echo "Restoring Spot service..."
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SPOT_SERVICE \
  --desired-count 2

# 6. 等待恢复
echo "Waiting for recovery..."
sleep 120

# 7. 验证清理完成
echo "Verifying cleanup..."
aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SPOT_SERVICE $STANDARD_SERVICE

echo "=== Test Complete ==="
```

## 性能测试

### Lambda 冷启动测试

```bash
# 强制冷启动并测量时间
for i in {1..5}; do
  echo "Test $i:"
  time aws lambda invoke \
    --function-name $DETECTOR_NAME \
    --payload '{}' \
    /dev/null
done
```

### ECS 服务启动时间测试

```bash
# 测量服务启动时间
START_TIME=$(date +%s)

aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $STANDARD_SERVICE \
  --desired-count 2

# 等待服务稳定
aws ecs wait services-stable \
  --cluster $CLUSTER_NAME \
  --services $STANDARD_SERVICE

END_TIME=$(date +%s)
echo "Startup time: $((END_TIME - START_TIME)) seconds"
```

## 手动测试故障转移

### 方法 1：停止 Spot 任务

```bash
# 获取并停止 Spot 任务
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

### 方法 2：修改服务容量

```bash
# 模拟容量不足
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SPOT_SERVICE \
  --desired-count 0

# 稍后恢复
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SPOT_SERVICE \
  --desired-count 2
```

### 方法 3：手动调用 Lambda

```bash
# 直接触发故障转移
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

## 监控测试执行

### 实时日志监控

```bash
# 监控所有相关日志
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-SpotErrorDetector" --follow &
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-FargateFailbackOrchestrator" --follow &
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-SpotSuccessMonitor" --follow &
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-CleanupOrchestrator" --follow &

# 监控 ECS 事件
aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SPOT_SERVICE $STANDARD_SERVICE \
  --query 'services[].events[:3]'
```

### DynamoDB 监控

```bash
# 监视错误计数器变化
watch -n 5 'aws dynamodb scan --table-name fargate-spot-error-counter'
```

## 测试检查清单

### 部署前检查

- [ ] `npm run build` 成功
- [ ] `npm test` 通过
- [ ] `npm run synth` 生成有效模板
- [ ] 代码审查完成

### 部署后验证

- [ ] CloudFormation 堆栈创建成功
- [ ] ECS 服务运行正常
- [ ] Lambda 函数可调用
- [ ] EventBridge 规则启用
- [ ] DynamoDB 表可访问
- [ ] SNS Topic 可发布
- [ ] ALB 健康检查通过

### 功能测试

- [ ] 故障转移触发正常
- [ ] 标准服务启动正常
- [ ] Spot 服务停止正常
- [ ] 恢复触发正常
- [ ] 清理完成正常
- [ ] 通知发送正常

## 故障排除测试

### 测试错误场景

```bash
# 测试 DynamoDB 不可用时 Lambda 行为
aws iam detach-role-policy \
  --role-name EcsFargateSpotFailoverStack-LambdaExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess

# 执行测试
# ...

# 恢复权限
aws iam attach-role-policy \
  --role-name EcsFargateSpotFailoverStack-LambdaExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess
```

## 持续集成

### GitHub Actions 示例

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

## 最佳实践

1. **测试隔离**: 每个测试独立，不依赖其他测试状态
2. **Mock 外部依赖**: AWS 服务使用 Mock，不实际调用
3. **测试命名**: 描述性行为，如 `should trigger failover when threshold reached`
4. **覆盖率**: 保持核心代码覆盖率 > 80%
5. **持续集成**: 每次提交前运行完整测试套件
