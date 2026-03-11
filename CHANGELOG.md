# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of ECS Fargate Spot Failover solution
- Complete CDK infrastructure with TypeScript
- Four Lambda functions for failover orchestration
- Application Load Balancer integration
- DynamoDB for state management
- SNS notifications
- EventBridge rules for ECS events
- Sample nginx application
- Full documentation suite
- MIT License

### Features
- Automatic failover from Fargate Spot to Standard Fargate
- Automatic recovery when Spot instances become available
- Configurable failure threshold (default: 3)
- Configurable cleanup delay (default: 30 seconds)
- Real-time monitoring and alerting
- One-click deployment with CDK
- Cost optimization up to 70% savings

## [1.0.0] - 2024-XX-XX

### Added
- Initial stable release
- TypeScript support for all Lambda functions
- AWS SDK v3 migration
- Complete architecture with VPC, ECS, ALB
- Multi-environment deployment support
- Comprehensive documentation

### Security
- IAM least privilege principle
- Security groups with minimal access
- Private subnets for ECS tasks
- Encrypted DynamoDB tables

## Migration Guide

### Upgrading from AWS SDK v2 to v3

The Lambda functions have been migrated from AWS SDK v2 to v3. If you have customizations:

1. Update imports:
```typescript
// Old (v2)
import * as AWS from 'aws-sdk';
const ecs = new AWS.ECS();

// New (v3)
import { ECSClient, DescribeServicesCommand } from '@aws-sdk/client-ecs';
const ecsClient = new ECSClient({});
```

2. Update API calls:
```typescript
// Old (v2)
const result = await ecs.describeServices(params).promise();

// New (v3)
const result = await ecsClient.send(new DescribeServicesCommand(params));
```

3. Update package.json dependencies:
```json
{
  "dependencies": {
    "@aws-sdk/client-ecs": "^3.450.0",
    "@aws-sdk/client-dynamodb": "^3.450.0",
    "@aws-sdk/lib-dynamodb": "^3.450.0",
    "@aws-sdk/client-sns": "^3.450.0",
    "@aws-sdk/client-lambda": "^3.450.0"
  }
}
```

## Notes

### Versioning Strategy

- **MAJOR**: Breaking changes to infrastructure or API
- **MINOR**: New features, backwards compatible
- **PATCH**: Bug fixes, backwards compatible

### Deprecation Policy

- Features will be marked as deprecated one minor version before removal
- Deprecated features will be documented in this changelog
- Migration guides will be provided for breaking changes
