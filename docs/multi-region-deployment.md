# Multi-Region Deployment Guide

This guide explains how to deploy the ECS Fargate Spot Failover solution across multiple AWS regions.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Deployment Methods](#deployment-methods)
- [DynamoDB Global Tables](#dynamodb-global-tables)
- [Failover Strategy](#failover-strategy)
- [Monitoring](#monitoring)

## Overview

Multi-region deployment provides:
- **High Availability**: Automatic failover between regions
- **Disaster Recovery**: DR regions for business continuity
- **Latency Reduction**: Deploy closer to users
- **Compliance**: Meet data residency requirements

## Architecture

```
                    Route53
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    Health Check   Health Check   Health Check
         │             │             │
         ▼             ▼             ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ us-east-1│  │ us-west-2│  │ eu-west-1│
   │ (Primary)│  │   (DR)   │  │   (DR)   │
   └────┬─────┘  └────┬─────┘  └────┬─────┘
        │             │             │
   DynamoDB      DynamoDB      DynamoDB
   Global Table  Global Table  Global Table
```

## Configuration

### Region Configuration File

Edit `src/config/regions.ts` to define your regions:

```typescript
export const DEFAULT_REGION_CONFIG: Record<string, RegionConfig> = {
  'us-east-1': {
    region: 'us-east-1',
    name: 'US East (N. Virginia)',
    type: 'primary',
    vpcCidr: '10.0.0.0/16',
    azCount: 2,
    capacityProviderWeights: {
      fargate: 1,
      fargateSpot: 3,
    },
    sampleAppDesiredCount: 2,
    enabled: true,
  },
  'us-west-2': {
    region: 'us-west-2',
    name: 'US West (Oregon)',
    type: 'dr',
    vpcCidr: '10.1.0.0/16',
    azCount: 2,
    capacityProviderWeights: {
      fargate: 1,
      fargateSpot: 3,
    },
    sampleAppDesiredCount: 2,
    enabled: true,
    replication: {
      sourceRegion: 'us-east-1',
      replicateDynamoDB: true,
    },
  },
};
```

### Environment Variables

Configure GitHub Secrets for each region:

```
AWS_ROLE_ARN_US_EAST_1
AWS_ROLE_ARN_US_WEST_2
AWS_ROLE_ARN_EU_WEST_1
AWS_ACCOUNT_ID_US_EAST_1
AWS_ACCOUNT_ID_US_WEST_2
AWS_ACCOUNT_ID_EU_WEST_1
```

## Deployment Methods

### 1. Deploy to All Enabled Regions

```bash
# Deploy to all regions marked as enabled: true
npm run deploy -- -c multiRegion=true
```

### 2. Deploy to Specific Regions

```bash
# Deploy to specific regions
npm run deploy -- -c deployRegions=us-east-1,us-west-2
```

### 3. Deploy with Global Tables

```bash
# Enable DynamoDB Global Tables for cross-region replication
npm run deploy -- -c multiRegion=true -c enableGlobalTables=true
```

### 4. GitHub Actions Multi-Region Deployment

#### Automatic Deployment
Push to `main` branch deploys to all enabled regions:

```yaml
# .github/workflows/cd-multi-region.yml triggers automatically
```

#### Manual Deployment

1. Go to **Actions** → **CD - Multi-Region Deployment**
2. Click **Run workflow**
3. Specify regions (optional): `us-east-1,us-west-2`
4. Enable Global Tables (optional): Check the box
5. Click **Run workflow**

## DynamoDB Global Tables

### Enable Global Tables

Global Tables provide:
- Automatic cross-region replication
- Single-digit millisecond latency
- Conflict-free replicated data

```bash
npm run deploy -- -c multiRegion=true -c enableGlobalTables=true
```

### Replication Behavior

| Operation | Behavior |
|-----------|----------|
| Write | Replicated to all regions within seconds |
| Read | Served from local region |
| Conflict Resolution | Last writer wins |

### Limitations

- TTL deletion is not replicated
- Point-in-time recovery is per-region
- On-demand backup is per-region

## Failover Strategy

### DNS Failover with Route53

Configure Route53 health checks and failover routing:

```json
{
  "Comment": "Failover routing policy",
  "Changes": [
    {
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "app.example.com",
        "Type": "A",
        "SetIdentifier": "primary",
        "Failover": "PRIMARY",
        "AliasTarget": {
          "HostedZoneId": "Z35SXDOTRQ7X7K",
          "DNSName": "primary-alb.amazonaws.com",
          "EvaluateTargetHealth": true
        },
        "HealthCheckId": "primary-health-check-id"
      }
    },
    {
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "app.example.com",
        "Type": "A",
        "SetIdentifier": "secondary",
        "Failover": "SECONDARY",
        "AliasTarget": {
          "HostedZoneId": "Z35SXDOTRQ7X7K",
          "DNSName": "dr-alb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }
  ]
}
```

### Application-Level Failover

Use DynamoDB Global Tables to share state across regions:

```typescript
// Lambda in any region reads/writes to DynamoDB
// Data is automatically replicated
const result = await dynamodb.get({
  TableName: 'fargate-spot-error-counter',
  Key: { service_name: 'my-service' }
});
```

## Monitoring

### CloudWatch Dashboards

Each region has its own CloudWatch dashboard:
- `ECS-FargateSpot-Failover-us-east-1`
- `ECS-FargateSpot-Failover-us-west-2`

### Cross-Region Alarms

Set up CloudWatch cross-region alarms:

```bash
aws cloudwatch put-composite-alarm \
  --alarm-name multi-region-health \
  --alarm-rule "ALARM(us-east-1-health) AND ALARM(us-west-2-health)" \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:alerts
```

### X-Ray Service Map

View cross-region traces in X-Ray:

```bash
# Get service graph across regions
aws xray get-service-graph \
  --start-time $(date -d '1 hour ago' +%s) \
  --end-time $(date +%s) \
  --region us-east-1
```

## Cost Considerations

Multi-region deployment increases costs:

| Component | Additional Cost |
|-----------|-----------------|
| ECS Tasks | Per region |
| ALB | Per region |
| DynamoDB Global Tables | Write replication charges |
| Data Transfer | Cross-region replication |
| CloudWatch | Per region |

**Estimate**: ~2-3x single-region cost for 2 regions.

## Troubleshooting

### Deployment Issues

**Problem**: Stack fails in one region
```bash
# Check CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name EcsFargateSpotFailoverStack-us-west-2 \
  --region us-west-2
```

**Problem**: Global Table replication lag
```bash
# Check replication status
aws dynamodb describe-global-table \
  --global-table-name fargate-spot-error-counter \
  --region us-east-1
```

### Performance Issues

**Problem**: High latency in DR region
- Check VPC peering or Transit Gateway
- Verify NAT Gateway is not throttling

### Failover Issues

**Problem**: DNS not failing over
- Check Route53 health check status
- Verify ALB health checks are passing

## Best Practices

1. **Start Small**: Deploy to 2 regions first
2. **Test Failover**: Regular DR drills
3. **Monitor Replication Lag**: Alert if > 1 minute
4. **Use Infrastructure as Code**: Same stack in all regions
5. **Tag Resources**: Identify region and purpose
6. **Automate**: Use CI/CD for all region deployments

## Example: Complete Multi-Region Setup

```bash
# 1. Configure regions
vim src/config/regions.ts

# 2. Set up GitHub Secrets for each region
# AWS_ROLE_ARN_US_EAST_1
# AWS_ROLE_ARN_US_WEST_2
# etc.

# 3. Deploy to all enabled regions
npm run build
npm run deploy -- -c multiRegion=true -c enableGlobalTables=true

# 4. Configure Route53 failover
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch file://route53-config.json

# 5. Verify deployment
aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack-us-east-1

aws cloudformation describe-stacks \
  --stack-name EcsFargateSpotFailoverStack-us-west-2
```

## Related Documentation

- [AWS Global Infrastructure](https://aws.amazon.com/about-aws/global-infrastructure/)
- [DynamoDB Global Tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html)
- [Route53 Failover Routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover.html)
- [CDK Cross-Region References](https://docs.aws.amazon.com/cdk/latest/guide/resources.html#resources_external)
