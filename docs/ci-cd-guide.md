# CI/CD 指南

本指南介绍 ECS Fargate Spot Failover 项目的持续集成和持续部署配置。

## 目录

- [概述](#概述)
- [工作流说明](#工作流说明)
- [环境配置](#环境配置)
- [Secrets 配置](#secrets-配置)
- [部署流程](#部署流程)
- [故障排除](#故障排除)

## 概述

项目使用 GitHub Actions 实现完整的 CI/CD 流水线，包括：

- **CI (持续集成)**: 代码质量检查、单元测试、构建
- **CD (持续部署)**: 自动部署到开发/预发布/生产环境
- **PR 检查**: Pull Request 时的自动化检查
- **发布管理**: 版本发布和工件管理

## 工作流说明

### 1. CI 工作流 (`.github/workflows/ci.yml`)

**触发条件**:
- Push 到 `main` 或 `develop` 分支
- Pull Request 到 `main` 或 `develop` 分支

**任务**:
| 任务 | 说明 |
|------|------|
| lint-and-format | ESLint 和 Prettier 检查 |
| type-check | TypeScript 类型检查 |
| test | 运行单元测试并生成覆盖率报告 |
| build | 构建项目并上传工件 |
| cdk-synth | 合成 CloudFormation 模板 |

### 2. PR 检查 (`.github/workflows/pr.yml`)

**触发条件**:
- Pull Request 创建或更新

**任务**:
| 任务 | 说明 |
|------|------|
| lint | 代码风格检查 |
| test | 单元测试和覆盖率报告 |
| build | TypeScript 编译和构建 |
| cdk-diff | 生成基础设施变更对比 |
| security-scan | 安全漏洞扫描 |
| pr-size-check | PR 大小检查 |
| conventional-commits | 提交消息规范检查 |

### 3. 开发环境部署 (`.github/workflows/cd-dev.yml`)

**触发条件**:
- Push 到 `develop` 分支
- 手动触发 (workflow_dispatch)

**任务**:
| 任务 | 说明 |
|------|------|
| deploy | 部署到 AWS 开发账户 |
| smoke-test | 冒烟测试验证部署 |

### 4. 预发布环境部署 (`.github/workflows/cd-staging.yml`)

**触发条件**:
- Push 到 `main` 分支
- 手动触发

**任务**:
| 任务 | 说明 |
|------|------|
| approval-check | 审批检查 |
| deploy | 部署到 AWS 预发布账户 |
| integration-test | 集成测试 |

### 5. 生产环境部署 (`.github/workflows/cd-prod.yml`)

**触发条件**:
- 仅手动触发 (workflow_dispatch)
- 需要输入版本标签

**任务**:
| 任务 | 说明 |
|------|------|
| pre-deployment-check | 部署前验证 |
| deploy | 部署到 AWS 生产账户 |
| smoke-test | 生产环境冒烟测试 |
| notify-failure | 失败时通知 |

**注意**: 生产部署需要 GitHub Environment 的审批。

### 6. 发布工作流 (`.github/workflows/release.yml`)

**触发条件**:
- 推送符合 `v*.*.*` 格式的标签

**任务**:
| 任务 | 说明 |
|------|------|
| verify | 验证标签格式和 CHANGELOG |
| build-release | 构建发布工件 |
| create-release | 创建 GitHub Release |
| publish-npm | 发布到 NPM (可选) |
| notify | 发送通知 |

## 环境配置

### GitHub Environments

在仓库设置中创建以下环境：

1. **development**
   - 不需要保护规则
   - 用于开发环境部署

2. **staging**
   - 需要 1 个审批
   - 用于预发布环境部署

3. **production**
   - 需要 2 个审批
   - 部署超时时间：30 分钟
   - 用于生产环境部署

### AWS 账户设置

每个环境需要独立的 AWS 账户：

```
┌─────────────────┐
│   Development   │
│   (Dev Account) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Staging      │
│ (Staging Acct)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Production    │
│  (Prod Account) │
└─────────────────┘
```

## Secrets 配置

在 GitHub 仓库 Settings > Secrets and variables > Actions 中添加：

### AWS 相关

| Secret | 说明 | 示例 |
|--------|------|------|
| `AWS_ROLE_ARN_DEV` | 开发环境 IAM Role ARN | `arn:aws:iam::123456789012:role/GitHubActionsRole` |
| `AWS_ACCOUNT_ID_DEV` | 开发环境账户 ID | `123456789012` |
| `AWS_ROLE_ARN_STAGING` | 预发布环境 IAM Role ARN | `arn:aws:iam::234567890123:role/GitHubActionsRole` |
| `AWS_ACCOUNT_ID_STAGING` | 预发布环境账户 ID | `234567890123` |
| `AWS_ROLE_ARN_PROD` | 生产环境 IAM Role ARN | `arn:aws:iam::345678901234:role/GitHubActionsRole` |
| `AWS_ACCOUNT_ID_PROD` | 生产环境账户 ID | `345678901234` |

### 其他集成

| Secret | 说明 | 获取方式 |
|--------|------|----------|
| `CODECOV_TOKEN` | Codecov 覆盖率上传令牌 | [Codecov](https://codecov.io/) |
| `SLACK_WEBHOOK_URL` | Slack 通知 Webhook | Slack App |
| `NPM_TOKEN` | NPM 发布令牌 | [NPM](https://www.npmjs.com/) |

### 在 AWS 中配置 OIDC

GitHub Actions 使用 OIDC 与 AWS 集成，无需存储长期凭证。

**1. 创建 IAM OIDC 身份提供商**:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --thumbprint-list 6938fd4e98bab03faadb97b34396831e3780aea1 \
  --client-id-list sts.amazonaws.com
```

**2. 创建 IAM Role**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:your-org/ecs-fargate-spot-failover:*"
        }
      }
    }
  ]
}
```

**3. 附加权限策略**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "ec2:*",
        "ecs:*",
        "iam:*",
        "lambda:*",
        "dynamodb:*",
        "sns:*",
        "events:*",
        "logs:*",
        "elasticloadbalancing:*"
      ],
      "Resource": "*"
    }
  ]
}
```

## 部署流程

### 开发环境部署

```bash
# 方式 1: 推送到 develop 分支
git checkout develop
git merge feature/your-feature
git push origin develop

# 方式 2: 手动触发
# 在 GitHub Actions 页面选择 "CD - Development" 工作流，点击 "Run workflow"
```

### 预发布环境部署

```bash
# 推送到 main 分支
git checkout main
git merge develop
git push origin main
```

### 生产环境部署

```bash
# 1. 创建并推送标签
git checkout main
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0

# 2. 在 GitHub Actions 页面选择 "CD - Production"
# 3. 输入版本标签 (v1.0.0)
# 4. 等待审批
# 5. 部署执行
```

## 版本管理

### 语义化版本

项目使用 [Semantic Versioning](https://semver.org/):

- **MAJOR**: 不兼容的 API 变更
- **MINOR**: 向后兼容的功能添加
- **PATCH**: 向后兼容的问题修复

### 发布流程

1. 更新 `CHANGELOG.md`
2. 创建 PR 到 main 分支
3. 合并后创建标签: `git tag -a v1.0.0 -m "Release v1.0.0"`
4. 推送标签: `git push origin v1.0.0`
5. 自动触发发布工作流

## 提交消息规范

使用 [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**类型**:
- `feat`: 新功能
- `fix`: 错误修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 代码重构
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具相关
- `ci`: CI/CD 相关

**示例**:
```
feat(lambda): add support for multiple services

fix(cdk): correct IAM role permissions
docs: update deployment guide
ci: add production deployment workflow
```

## 故障排除

### 常见问题

#### 1. AWS 凭证错误

```
Error: Could not assume role with OIDC
```

**解决**:
- 检查 IAM Role 的 Trust Policy 是否正确
- 确认 `AWS_ROLE_ARN_*` secrets 配置正确
- 验证 OIDC Provider 是否已创建

#### 2. CDK 引导错误

```
Error: This stack uses assets, so the toolkit stack must be deployed
```

**解决**:
```bash
# 手动执行引导
cdk bootstrap aws://ACCOUNT_ID/REGION
```

#### 3. 部署权限不足

```
API: iam:CreateRole User: xxx is not authorized
```

**解决**: 为 GitHub Actions Role 添加 `iam:*` 权限或更细粒度的权限。

#### 4. 测试失败

```
Test suite failed to run
```

**解决**:
```bash
# 本地运行测试
npm ci
npm test
```

### 调试工作流

1. **启用调试日志**:
   ```yaml
   env:
     ACTIONS_STEP_DEBUG: true
     ACTIONS_RUNNER_DEBUG: true
   ```

2. **查看详细输出**:
   - 在 GitHub Actions 页面点击失败的 job
   - 展开步骤查看详细日志

3. **本地复现**:
   ```bash
   # 使用 act 工具本地运行
   act -j test
   ```

### 回滚部署

如果生产部署失败：

```bash
# 使用 AWS CLI 回滚 CloudFormation 堆栈
aws cloudformation rollback-stack \
  --stack-name EcsFargateSpotFailoverStack

# 或使用 CDK
cdk destroy --force
git checkout <previous-tag>
cdk deploy
```

## 最佳实践

1. **分支保护**:
   - `main` 分支需要 PR 审查
   - 所有检查必须通过才能合并

2. **审批流程**:
   - 预发布环境: 1 人审批
   - 生产环境: 2 人审批

3. **监控**:
   - 部署后自动运行冒烟测试
   - 失败时自动发送通知

4. **文档**:
   - 每个版本更新 CHANGELOG
   - 重大变更更新 README
