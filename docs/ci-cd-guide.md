# CI/CD Guide

This guide describes the Continuous Integration and Continuous Deployment configuration for the ECS Fargate Spot Failover project.

## Table of Contents

- [Overview](#overview)
- [Workflow Descriptions](#workflow-descriptions)
- [Environment Configuration](#environment-configuration)
- [Secrets Configuration](#secrets-configuration)
- [Deployment Process](#deployment-process)
- [Troubleshooting](#troubleshooting)

## Overview

The project uses GitHub Actions to implement a complete CI/CD pipeline, including:

- **CI (Continuous Integration)**: Code quality checks, unit tests, and builds
- **CD (Continuous Deployment)**: Automated deployment to development/staging/production environments
- **PR Checks**: Automated checks for Pull Requests
- **Release Management**: Version releases and artifact management

## Workflow Descriptions

### 1. CI Workflow (`.github/workflows/ci.yml`)

**Triggers**:
- Push to `main` or `develop` branch
- Pull Request to `main` or `develop` branch

**Jobs**:
| Job | Description |
|------|------|
| lint-and-format | ESLint and Prettier checks |
| type-check | TypeScript type checking |
| test | Run unit tests and generate coverage reports |
| build | Build the project and upload artifacts |
| cdk-synth | Synthesize CloudFormation templates |

### 2. PR Checks (`.github/workflows/pr.yml`)

**Triggers**:
- Pull Request creation or update

**Jobs**:
| Job | Description |
|------|------|
| lint | Code style check |
| test | Unit tests and coverage reports |
| build | TypeScript compilation and build |
| cdk-diff | Generate infrastructure change comparison |
| security-scan | Security vulnerability scanning |
| pr-size-check | PR size check |
| conventional-commits | Commit message convention check |

### 3. Development Environment Deployment (`.github/workflows/cd-dev.yml`)

**Triggers**:
- Push to `develop` branch
- Manual trigger (workflow_dispatch)

**Jobs**:
| Job | Description |
|------|------|
| deploy | Deploy to AWS development account |
| smoke-test | Smoke test verification after deployment |

### 4. Staging Environment Deployment (`.github/workflows/cd-staging.yml`)

**Triggers**:
- Push to `main` branch
- Manual trigger

**Jobs**:
| Job | Description |
|------|------|
| approval-check | Approval check |
| deploy | Deploy to AWS staging account |
| integration-test | Integration testing |

### 5. Production Environment Deployment (`.github/workflows/cd-prod.yml`)

**Triggers**:
- Manual trigger only (workflow_dispatch)
- Version tag input required

**Jobs**:
| Job | Description |
|------|------|
| pre-deployment-check | Pre-deployment verification |
| deploy | Deploy to AWS production account |
| smoke-test | Production environment smoke test |
| notify-failure | Notification on failure |

**Note**: Production deployment requires GitHub Environment approval.

### 6. Release Workflow (`.github/workflows/release.yml`)

**Triggers**:
- Push of tags matching `v*.*.*` format

**Jobs**:
| Job | Description |
|------|------|
| verify | Verify tag format and CHANGELOG |
| build-release | Build release artifacts |
| create-release | Create GitHub Release |
| publish-npm | Publish to NPM (optional) |
| notify | Send notifications |

## Environment Configuration

### GitHub Environments

Create the following environments in your repository settings:

1. **development**
   - No protection rules required
   - Used for development environment deployment

2. **staging**
   - Requires 1 approval
   - Used for staging environment deployment

3. **production**
   - Requires 2 approvals
   - Deployment timeout: 30 minutes
   - Used for production environment deployment

### AWS Account Setup

Each environment requires a separate AWS account:

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

## Secrets Configuration

Add the following in GitHub repository Settings > Secrets and variables > Actions:

### AWS Related

| Secret | Description | Example |
|--------|-------------|---------|
| `AWS_ROLE_ARN_DEV` | Development environment IAM Role ARN | `arn:aws:iam::123456789012:role/GitHubActionsRole` |
| `AWS_ACCOUNT_ID_DEV` | Development environment account ID | `123456789012` |
| `AWS_ROLE_ARN_STAGING` | Staging environment IAM Role ARN | `arn:aws:iam::234567890123:role/GitHubActionsRole` |
| `AWS_ACCOUNT_ID_STAGING` | Staging environment account ID | `234567890123` |
| `AWS_ROLE_ARN_PROD` | Production environment IAM Role ARN | `arn:aws:iam::345678901234:role/GitHubActionsRole` |
| `AWS_ACCOUNT_ID_PROD` | Production environment account ID | `345678901234` |

### Other Integrations

| Secret | Description | How to Obtain |
|--------|-------------|---------------|
| `CODECOV_TOKEN` | Codecov coverage upload token | [Codecov](https://codecov.io/) |
| `SLACK_WEBHOOK_URL` | Slack notification webhook | Slack App |
| `NPM_TOKEN` | NPM publish token | [NPM](https://www.npmjs.com/) |

### Configuring OIDC in AWS

GitHub Actions uses OIDC to integrate with AWS without storing long-term credentials.

**1. Create IAM OIDC Identity Provider**:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --thumbprint-list 6938fd4e98bab03faadb97b34396831e3780aea1 \
  --client-id-list sts.amazonaws.com
```

**2. Create IAM Role**:

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

**3. Attach Permission Policy**:

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

## Deployment Process

### Development Environment Deployment

```bash
# Method 1: Push to develop branch
git checkout develop
git merge feature/your-feature
git push origin develop

# Method 2: Manual trigger
# In GitHub Actions page, select "CD - Development" workflow, click "Run workflow"
```

### Staging Environment Deployment

```bash
# Push to main branch
git checkout main
git merge develop
git push origin main
```

### Production Environment Deployment

```bash
# 1. Create and push tag
git checkout main
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0

# 2. In GitHub Actions page, select "CD - Production"
# 3. Enter version tag (v1.0.0)
# 4. Wait for approval
# 5. Deployment executes
```

## Version Management

### Semantic Versioning

The project uses [Semantic Versioning](https://semver.org/):

- **MAJOR**: Incompatible API changes
- **MINOR**: Backward-compatible feature additions
- **PATCH**: Backward-compatible bug fixes

### Release Process

1. Update `CHANGELOG.md`
2. Create PR to main branch
3. After merging, create tag: `git tag -a v1.0.0 -m "Release v1.0.0"`
4. Push tag: `git push origin v1.0.0`
5. Release workflow is automatically triggered

## Commit Message Convention

Using [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation update
- `style`: Code formatting (no functional changes)
- `refactor`: Code refactoring
- `perf`: Performance optimization
- `test`: Test related
- `chore`: Build/tool related
- `ci`: CI/CD related

**Examples**:
```
feat(lambda): add support for multiple services

fix(cdk): correct IAM role permissions
docs: update deployment guide
ci: add production deployment workflow
```

## Troubleshooting

### Common Issues

#### 1. AWS Credential Error

```
Error: Could not assume role with OIDC
```

**Solution**:
- Check if IAM Role's Trust Policy is correct
- Confirm `AWS_ROLE_ARN_*` secrets are configured correctly
- Verify OIDC Provider has been created

#### 2. CDK Bootstrap Error

```
Error: This stack uses assets, so the toolkit stack must be deployed
```

**Solution**:
```bash
# Execute bootstrap manually
cdk bootstrap aws://ACCOUNT_ID/REGION
```

#### 3. Insufficient Deployment Permissions

```
API: iam:CreateRole User: xxx is not authorized
```

**Solution**: Add `iam:*` permissions or more granular permissions to the GitHub Actions Role.

#### 4. Test Failures

```
Test suite failed to run
```

**Solution**:
```bash
# Run tests locally
npm ci
npm test
```

### Debugging Workflows

1. **Enable Debug Logging**:
   ```yaml
   env:
     ACTIONS_STEP_DEBUG: true
     ACTIONS_RUNNER_DEBUG: true
   ```

2. **View Detailed Output**:
   - Click on the failed job in GitHub Actions page
   - Expand steps to view detailed logs

3. **Local Reproduction**:
   ```bash
   # Use act tool to run locally
   act -j test
   ```

### Rollback Deployment

If production deployment fails:

```bash
# Use AWS CLI to rollback CloudFormation stack
aws cloudformation rollback-stack \
  --stack-name EcsFargateSpotFailoverStack

# Or use CDK
cdk destroy --force
git checkout <previous-tag>
cdk deploy
```

## Best Practices

1. **Branch Protection**:
   - `main` branch requires PR review
   - All checks must pass before merging

2. **Approval Process**:
   - Staging environment: 1 person approval
   - Production environment: 2 person approval

3. **Monitoring**:
   - Automatic smoke tests after deployment
   - Automatic notifications on failure

4. **Documentation**:
   - Update CHANGELOG for each version
   - Update README for major changes
