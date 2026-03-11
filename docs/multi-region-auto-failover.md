# Multi-Region Automatic Failover

🌍 **Key Differentiator**: Unlike other ECS Spot failover solutions, this project provides **automatic cross-region disaster recovery** with intelligent health monitoring and DNS-based failover.

## Overview

This feature provides **true multi-region high availability** by:

1. **Health Monitoring** - Continuously monitors all deployed regions
2. **Automatic Failover** - Switches traffic to healthy regions when primary fails
3. **DNS-Based Routing** - Uses Route53 health checks for automatic traffic routing
4. **State Synchronization** - DynamoDB Global Tables keep state consistent across regions
5. **Automatic Recovery** - Fails back to primary when it recovers

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Route53 DNS                                     │
│                    (Health Checks + Failover Routing)                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│   Primary Region     │   │   Secondary Region 1 │   │   Secondary Region 2 │
│   (us-east-1)        │   │   (us-west-2)        │   │   (eu-west-1)        │
├──────────────────────┤   ├──────────────────────┤   ├──────────────────────┤
│ ┌──────────────────┐ │   │ ┌──────────────────┐ │   │ ┌──────────────────┐ │
│ │   Network Load   │ │   │ │   Network Load   │ │   │ │   Network Load   │ │
│ │     Balancer     │ │   │ │     Balancer     │ │   │ │     Balancer     │ │
│ └────────┬─────────┘ │   │ └────────┬─────────┘ │   │ └────────┬─────────┘ │
│          │           │   │          │           │   │          │           │
│ ┌────────▼─────────┐ │   │ ┌────────▼─────────┐ │   │ ┌────────▼─────────┐ │
│ │ ECS Fargate Spot │ │   │ │ ECS Fargate Spot │ │   │ │ ECS Fargate Spot │ │
│ │ (with failover)  │ │   │ │ (with failover)  │ │   │ │ (with failover)  │ │
│ └────────┬─────────┘ │   │ └────────┬─────────┘ │   │ └────────┬─────────┘ │
│          │           │   │          │           │   │          │           │
│ ┌────────▼─────────┐ │   │ ┌────────▼─────────┐ │   │ ┌────────▼─────────┐ │
│ │ DynamoDB Global  │◄┼───┼►│ DynamoDB Global  │◄┼───┼►│ DynamoDB Global  │ │
│ │    Table         │ │   │ │    Table         │ │   │ │    Table         │ │
│ └──────────────────┘ │   │ └──────────────────┘ │   │ └──────────────────┘ │
└──────────────────────┘   └──────────────────────┘   └──────────────────────┘
                                       ▲
                                       │
┌──────────────────────────────────────┼──────────────────────────────────────┐
│                                      │                                       │
│                    ┌─────────────────┴─────────────────┐                    │
│                    │  Region Health Monitor Lambda     │                    │
│                    │  (every 30 seconds)               │                    │
│                    ├───────────────────────────────────┤                    │
│                    │  • Check NLB health               │                    │
│                    │  • Check ECS service status       │                    │
│                    │  • Check Spot capacity            │                    │
│                    │  • Update global state            │                    │
│                    │  • Execute DNS failover           │                    │
│                    └───────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Features

### 🎯 Intelligent Health Checks

The system monitors multiple health indicators:

| Check | Description | Threshold |
|-------|-------------|-----------|
| **NLB Health** | TCP connection failures | < 10% |
| **ECS Health** | Service and task status | All healthy |
| **Spot Capacity** | Consecutive Spot failures | < 3 failures |
| **Error Rate** | Application error rate | < 5% |
| **DynamoDB** | Database connectivity | Reachable |

### ⚡ Automatic Failover Triggers

Failover occurs when:
- Primary region shows `failed` status (4+ health checks failing)
- OR 3+ consecutive health check failures
- AND at least one secondary region is healthy

```
Primary Region Status:
├─ healthy        → Normal operation
├─ degraded       → Warning, monitor closely
├─ unhealthy      → Alert, prepare for failover
└─ failed         → 🚨 TRIGGER FAILOVER
```

### 🔄 Automatic Failback

When the primary region recovers:
- Must show `healthy` status
- AND have 2+ consecutive successful health checks
- Traffic automatically routes back to primary

### 📊 Standby Modes

#### Cold Standby (Default)
- Secondary regions: 0 running tasks
- Lower cost
- Failover time: ~2-3 minutes (tasks need to start)

#### Warm Standby
- Secondary regions: 1+ running tasks
- Higher cost (~2x for secondary)
- Failover time: ~30 seconds (tasks already running)

## Deployment

### Quick Start

```bash
# Deploy to 2 regions with cold standby
npm run deploy -- \
  -c primaryRegion=us-east-1 \
  -c secondaryRegions=us-west-2 \
  -c hostedZoneId=Z123456789 \
  -c dnsRecordName=app.example.com

# Deploy with warm standby (faster failover)
npm run deploy -- \
  -c primaryRegion=us-east-1 \
  -c secondaryRegions=us-west-2 \
  -c hostedZoneId=Z123456789 \
  -c dnsRecordName=app.example.com \
  -c warmStandby=true \
  -c secondaryDesiredCount=1

# Deploy to 3 regions
npm run deploy -- \
  -c primaryRegion=us-east-1 \
  -c secondaryRegions=us-west-2,eu-west-1 \
  -c hostedZoneId=Z123456789 \
  -c dnsRecordName=app.example.com
```

### Using CDK Stack Directly

```typescript
import { MultiRegionFailoverStack } from 'ecs-fargate-spot-failover-cdk';

new MultiRegionFailoverStack(app, 'MultiRegionStack', {
  primaryRegion: 'us-east-1',
  secondaryRegions: 'us-west-2,eu-west-1',
  hostedZoneId: 'Z123456789',
  dnsRecordName: 'app.example.com',
  warmStandby: true,        // Fast failover
  failoverThreshold: 3,     // Failover after 3 failures
  recoveryThreshold: 2,     // Failback after 2 successes
  enableGlobalTables: true, // Cross-region state sync
});
```

## Configuration

### Region Configuration

Edit `src/config/regions.ts`:

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
    sampleAppDesiredCount: 0,  // Cold standby
    enabled: true,
    replication: {
      sourceRegion: 'us-east-1',
      replicateDynamoDB: true,
    },
  },
};
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PRIMARY_REGION` | us-east-1 | Primary region |
| `SECONDARY_REGIONS` | us-west-2 | Comma-separated list |
| `FAILOVER_THRESHOLD` | 3 | Failover after N failures |
| `RECOVERY_THRESHOLD` | 2 | Failback after N successes |
| `HEALTH_CHECK_INTERVAL` | 30 | Seconds between checks |
| `ROUTE53_HOSTED_ZONE_ID` | - | Route53 zone ID |
| `DNS_RECORD_NAME` | app.example.com | DNS record name |

## Monitoring

### CloudWatch Dashboard

Access multi-region dashboards:

```bash
# Primary region
https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards

# Secondary region
https://console.aws.amazon.com/cloudwatch/home?region=us-west-2#dashboards
```

### Health Check Table

View current health status:

```bash
aws dynamodb scan \
  --table-name region-health-checks \
  --region us-east-1
```

### Global Failover State

Check failover status:

```bash
aws dynamodb get-item \
  --table-name global-failover-state \
  --key '{"stateId": {"S": "global"}}' \
  --region us-east-1
```

### Route53 Health Checks

View health check status:

```bash
aws route53 get-health-check-status \
  --health-check-id YOUR_HEALTH_CHECK_ID
```

## Testing Failover

### Manual Test

```bash
# Get current status
aws dynamodb get-item \
  --table-name global-failover-state \
  --key '{"stateId": {"S": "global"}}'

# Simulate primary region failure
# (Stop all services in primary region)
aws ecs update-service \
  --cluster fargate-spot-cluster \
  --service sample-app \
  --desired-count 0 \
  --region us-east-1

# Wait for health monitor to detect failure (~90 seconds)
# DNS will automatically route to secondary region

# Restore primary region
aws ecs update-service \
  --cluster fargate-spot-cluster \
  --service sample-app \
  --desired-count 2 \
  --region us-east-1

# Wait for automatic failback (~60 seconds)
```

### Automated Chaos Testing

Use AWS Fault Injection Simulator:

```bash
# Stop ECS tasks in primary region
aws fis start-experiment \
  --experiment-template-id EXT123456789
```

## Cost Considerations

### Cold Standby (Default)

| Component | Primary | Secondary |
|-----------|---------|-----------|
| ECS Tasks | $42K/month | $0 |
| NLB | $20/month | $20/month |
| DynamoDB Global Table | $50/month | $50/month |
| Lambda | $5/month | - |
| **Total** | **$42,095/month** | **$70/month** |

### Warm Standby

| Component | Primary | Secondary |
|-----------|---------|-----------|
| ECS Tasks | $42K/month | $21K/month |
| NLB | $20/month | $20/month |
| DynamoDB Global Table | $50/month | $50/month |
| Lambda | $5/month | - |
| **Total** | **$42,095/month** | **$21,090/month** |

**Recommendation**: Use cold standby for cost savings, warm standby for critical applications requiring <30s RTO.

## Comparison with Other Solutions

| Feature | This Solution | aws-fail2ban | ecs-spot-monitor |
|---------|--------------|--------------|------------------|
| **Single Region Spot→Standard** | ✅ | ✅ | ✅ |
| **Multi-Region Deployment** | ✅ | ❌ | ❌ |
| **Automatic DNS Failover** | ✅ | ❌ | ❌ |
| **Cross-Region State Sync** | ✅ | ❌ | ❌ |
| **Health-Based Routing** | ✅ | ❌ | ❌ |
| **Automatic Failback** | ✅ | ❌ | ❌ |
| **Warm/Cold Standby Options** | ✅ | ❌ | ❌ |

## Best Practices

### 1. Choose the Right Standby Mode

- **Cold Standby**: Development, staging, cost-sensitive production
- **Warm Standby**: Critical production, strict RTO requirements

### 2. Test Regularly

```bash
# Monthly DR drill
npm run test:failover -- --primary us-east-1 --secondary us-west-2
```

### 3. Monitor Replication Lag

```bash
# Alert if replication lag > 1 minute
aws cloudwatch put-metric-alarm \
  --alarm-name dynamodb-replication-lag \
  --metric-name ReplicationLag \
  --namespace AWS/DynamoDB \
  --threshold 60 \
  --comparison-operator GreaterThanThreshold
```

### 4. Use Health Checks in Applications

```javascript
// Your application should handle failover gracefully
app.get('/health', async (req, res) => {
  // Check database connectivity
  // Check external dependencies
  // Return 503 if unable to serve traffic
});
```

### 5. Configure Appropriate TTLs

```typescript
// DynamoDB TTL for health check records
healthCheckTable.addLocalSecondaryIndex({
  indexName: 'ttl-index',
  sortKey: { name: 'ttl', type: dynamodb.AttributeType.NUMBER },
});
```

## Troubleshooting

### Failover Not Triggering

```bash
# Check health monitor logs
aws logs tail /aws/lambda/MultiRegionFailover-RegionHealthMonitor --follow

# Check consecutive failures count
aws dynamodb get-item \
  --table-name region-health-checks \
  --key '{"region": {"S": "us-east-1"}, "timestamp": {"S": "latest"}}'
```

### DNS Not Updating

```bash
# Check Route53 health check status
aws route53 get-health-check-status --health-check-id ID

# Verify DNS record
aws route53 test-dns-answer \
  --hosted-zone-id ZONE_ID \
  --record-name app.example.com \
  --record-type A
```

### Replication Lag

```bash
# Check Global Table status
aws dynamodb describe-global-table \
  --global-table-name region-health-checks \
  --region us-east-1
```

## Roadmap

### Phase 1 (Current)
- ✅ Basic multi-region deployment
- ✅ Route53 DNS failover
- ✅ DynamoDB Global Tables
- ✅ Health monitoring Lambda

### Phase 2 (Planned)
- 🔄 AWS Global Accelerator support
- 📝 Latency-based routing
- 📝 Geolocation routing
- 📝 Weighted routing for canary deployments

### Phase 3 (Future)
- 🔮 ML-based predictive failover
- 🔮 Automatic capacity scaling in secondary regions
- 🔮 Cross-region VPC peering
- 🔮 PrivateLink for internal services

## Related Documentation

- [Multi-Region Deployment Guide](./multi-region-deployment.md)
- [Architecture Overview](./architecture-overview.md)
- [Route53 Health Checks](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover.html)
- [DynamoDB Global Tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html)
- [AWS Disaster Recovery Whitepaper](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-workloads-on-aws.html)
