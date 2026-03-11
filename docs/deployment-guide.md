# 部署指南

本指南详细介绍如何部署 ECS Fargate Spot 自动故障转移解决方案。

## 目录

- [准备工作](#准备工作)
- [快速部署](#快速部署)
- [分步部署](#分步部署)
- [配置选项](#配置选项)
- [验证部署](#验证部署)
- [故障排除](#故障排除)

## 准备工作

### 1. AWS 账户要求

- 有效的 AWS 账户
- 具备以下服务的权限：
  - Amazon ECS
  - AWS Lambda
  - Amazon DynamoDB
  - Amazon EventBridge
  - Amazon SNS
  - Amazon VPC
  - Application Load Balancer
  - AWS CloudWatch
  - AWS IAM

### 2. 本地环境要求

| 工具 | 最低版本 | 安装链接 |
|------|---------|---------|
| Node.js | 18.x | [下载](https://nodejs.org/) |
| AWS CLI | 2.x | [安装指南](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) |
| AWS CDK | 2.100+ | `npm install -g aws-cdk` |
| Git | 2.x | [下载](https://git-scm.com/) |

### 3. AWS 配置

```bash
# 配置 AWS CLI
aws configure

# 验证配置
aws sts get-caller-identity
```

### 4. CDK 引导

如果是首次在 AWS 账户中使用 CDK：

```bash
# 引导 CDK (每个区域只需执行一次)
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>

# 例如
cdk bootstrap aws://123456789012/us-east-1
```

## 快速部署

### 方式一：完整部署（推荐）

部署包含示例应用的完整解决方案：

```bash
# 克隆项目
git clone https://github.com/yourusername/ecs-fargate-spot-failover.git
cd ecs-fargate-spot-failover

# 安装依赖
npm install

# 一键部署
npm run deploy
```

部署完成后，你会看到类似输出：

```
EcsFargateSpotFailoverStack: creating CloudFormation changeset...

 ✅  EcsFargateSpotFailoverStack

Outputs:
EcsFargateSpotFailoverStack.ClusterName = fargate-spot-cluster
EcsFargateSpotFailoverStack.ErrorCounterTableName = fargate-spot-error-counter
EcsFargateSpotFailoverStack.LoadBalancerDNS = EcsFa-XXXXX.us-east-1.elb.amazonaws.com
EcsFargateSpotFailoverStack.NotificationTopicArn = arn:aws:sns:us-east-1:123456789012:...
EcsFargateSpotFailoverStack.SpotServiceName = sample-app
EcsFargateSpotFailoverStack.StandardServiceName = sample-app-standard
```

### 方式二：最小化部署

仅部署故障转移机制（适用于已有 ECS 服务的场景）：

```bash
npm run deploy:minimal
```

### 方式三：自定义部署

```bash
# 自定义副本数
npm run deploy -- -c sampleAppDesiredCount=4

# 自定义应用端口
npm run deploy -- -c appPort=8080

# 自定义副本数和端口
npm run deploy -- -c sampleAppDesiredCount=3 -c appPort=3000
```

## 分步部署

### 步骤 1：安装依赖

```bash
npm install
```

### 步骤 2：编译 TypeScript

```bash
npm run build
```

### 步骤 3：查看变更

```bash
npm run diff
```

### 步骤 4：合成 CloudFormation 模板

```bash
npm run synth
```

这会生成 `cdk.out/` 目录，包含 CloudFormation 模板。

### 步骤 5：部署

```bash
npm run deploy
```

## 配置选项

### CDK Context 参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `createSampleApp` | boolean | `true` | 是否创建示例应用 |
| `sampleAppDesiredCount` | number | `2` | Spot 服务初始副本数 |
| `appPort` | number | `80` | 应用端口 |

### 环境变量配置

编辑 Lambda 函数的环境变量（在 `src/ecs-fargate-spot-failover-stack.ts` 中）：

```typescript
// Spot Error Detector
spotErrorDetector.addEnvironment('FAILURE_THRESHOLD', '3');  // 故障转移阈值

// Cleanup Orchestrator
cleanupOrchestrator.addEnvironment('CLEANUP_DELAY', '30');   // 清理延迟(秒)

// 所有编排器
orchestrator.addEnvironment('SERVICE_STABLE_TIMEOUT', '300');  // 服务稳定超时(秒)
```

### 修改后重新部署

```bash
npm run build && npm run deploy
```

## 验证部署

### 1. 检查 CloudFormation 堆栈

```bash
aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs'
```

### 2. 验证 ECS 服务

```bash
# 查看集群
aws ecs describe-clusters --clusters fargate-spot-cluster

# 查看服务
aws ecs describe-services \
  --cluster fargate-spot-cluster \
  --services sample-app sample-app-standard
```

### 3. 验证 Lambda 函数

```bash
# 列出所有 Lambda 函数
aws lambda list-functions \
  --query 'Functions[?starts_with(FunctionName, `EcsFargateSpotFailoverStack`)].FunctionName'

# 测试 Spot Error Detector
aws lambda invoke \
  --function-name EcsFargateSpotFailoverStack-SpotErrorDetectorXXXX \
  --payload '{}' \
  /dev/stdout
```

### 4. 验证 DynamoDB 表

```bash
# 查看表结构
aws dynamodb describe-table \
  --table-name fargate-spot-error-counter

# 扫描表内容
aws dynamodb scan \
  --table-name fargate-spot-error-counter
```

### 5. 验证 EventBridge 规则

```bash
# 列出规则
aws events list-rules \
  --name-prefix EcsFargateSpotFailoverStack

# 查看规则详情
aws events describe-rule \
  --name EcsFargateSpotFailoverStack-EcsTaskStateChangeRuleXXXX
```

### 6. 访问示例应用

```bash
# 获取负载均衡器 DNS
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

# 测试访问
curl http://$ALB_DNS
```

## 配置告警通知

### 邮件通知

```bash
# 获取 SNS Topic ARN
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`NotificationTopicArn`].OutputValue' \
  --output text)

# 订阅邮件
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint your-email@example.com

# 确认订阅（查收邮件并点击确认链接）
```

### Slack 通知

1. 创建 Slack Webhook：[Slack API](https://api.slack.com/messaging/webhooks)
2. 创建 Lambda 函数处理 SNS 消息并发送到 Slack
3. 订阅 SNS Topic 到该 Lambda

### SMS 通知

```bash
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol sms \
  --notification-endpoint +1234567890
```

## 多环境部署

### 开发环境

```bash
# 使用 CDK 环境变量
export CDK_DEFAULT_ACCOUNT=123456789012
export CDK_DEFAULT_REGION=us-east-1

# 部署到开发环境
cdk deploy -c env=dev
```

### 生产环境

```bash
# 使用不同的栈名称
cdk deploy EcsFargateSpotFailoverStack-Prod \
  -c env=prod \
  -c sampleAppDesiredCount=4
```

### 使用 cdk.json 配置

```json
{
  "context": {
    "@aws-cdk/core:enableStackNameDuplicates": true,
    "env": "prod",
    "sampleAppDesiredCount": 4
  }
}
```

## 故障排除

### 部署失败

#### 1. CDK 引导未执行

```
Error: This stack uses assets, so the toolkit stack must be deployed to the environment
```

**解决**:
```bash
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

#### 2. IAM 权限不足

```
API: iam:CreateRole User: xxx is not authorized to perform: iam:CreateRole
```

**解决**: 确保 IAM 用户/角色有足够的权限

#### 3. 资源名称冲突

```
AlreadyExistsException: Stack already exists
```

**解决**: 使用不同的栈名称或先删除现有堆栈

### 运行时问题

#### Lambda 函数超时

检查 CloudWatch Logs:
```bash
aws logs tail "/aws/lambda/EcsFargateSpotFailoverStack-FargateFailbackOrchestrator" --follow
```

**可能原因**:
- ECS 服务启动时间过长
- 网络连接问题

**解决**: 增加 Lambda timeout 或调整 `SERVICE_STABLE_TIMEOUT`

#### EventBridge 未触发

```bash
# 检查规则状态
aws events describe-rule --name <rule-name>

# 检查目标配置
aws events list-targets-by-rule --rule <rule-name>
```

#### DynamoDB 访问失败

检查 Lambda 执行角色的 IAM 策略是否包含 DynamoDB 访问权限。

## 更新部署

### 更新代码后重新部署

```bash
# 拉取最新代码
git pull origin main

# 重新安装依赖（如有更新）
npm install

# 编译并部署
npm run build && npm run deploy
```

### 部分更新

```bash
# 只更新 Lambda 代码
npm run build
cdk deploy --hotswap

# 注意：--hotswap 不适用于基础设施变更
```

## 回滚部署

### 使用 CloudFormation 回滚

```bash
# 查看堆栈历史
aws cloudformation describe-stack-events \
  --stack-name EcsFargateSpotFailoverStack

# 回滚到特定版本（如果有）
aws cloudformation rollback-stack \
  --stack-name EcsFargateSpotFailoverStack
```

### 使用 CDK 销毁并重建

```bash
# 销毁
cdk destroy

# 重新部署
cdk deploy
```

## 下一步

部署完成后，请参考以下文档：

- [执行指南](execution-guide.md) - 了解系统如何运行
- [测试指南](testing-guide.md) - 测试故障转移功能
- [运维手册](operations-manual.md) - 日常运维操作
