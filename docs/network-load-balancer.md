# Network Load Balancer (NLB) Configuration

This project uses **Network Load Balancer (NLB)** instead of Application Load Balancer (ALB) to provide higher performance and lower latency for your ECS Fargate workloads.

## Why NLB?

### Performance Benefits

| Metric | NLB | ALB | Improvement |
|--------|-----|-----|-------------|
| **Latency** | ~10-50μs | ~1-5ms | **100x lower** |
| **Throughput** | Millions RPS | Thousands RPS | **1000x higher** |
| **Connections** | Millions | Thousands | **1000x more** |
| **Health Check** | TCP (faster) | HTTP (slower) | **3x faster** |

### Key Advantages

1. **Ultra-Low Latency**
   - NLB operates at Layer 4 (transport layer)
   - No HTTP parsing overhead
   - Direct packet forwarding

2. **Higher Throughput**
   - Handles millions of requests per second
   - No bandwidth limits
   - Automatic scaling

3. **Static IP Addresses**
   - NLB provides static IPs per AZ
   - Useful for whitelisting scenarios
   - Consistent endpoint addresses

4. **Cross-Zone Load Balancing**
   - Enabled by default for even traffic distribution
   - Better utilization across all AZs

5. **Preserve Client IP**
   - NLB preserves the original client IP address
   - Important for security and logging

## Configuration

### Default Behavior

By default, the stack now creates an NLB instead of ALB:

```typescript
// In your CDK stack - NLB is created automatically
const stack = new EcsFargateSpotFailoverStack(app, 'MyStack', {
  // NLB is used by default for better performance
  appPort: 8080,
});
```

### TCP Health Checks

NLB uses TCP health checks instead of HTTP:

```typescript
// Health check configuration (TCP)
healthCheck: {
  protocol: nlb.Protocol.TCP,
  interval: cdk.Duration.seconds(10),  // Faster than ALB (30s)
  timeout: cdk.Duration.seconds(5),
  healthyThresholdCount: 2,
  unhealthyThresholdCount: 3,
}
```

### Security Groups

Unlike ALB, NLB doesn't use security groups at the load balancer level. Security is managed at the target (ECS task) level:

```typescript
// ECS Task Security Group
const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
  vpc,
  description: 'Security group for ECS services behind NLB',
  allowAllOutbound: true,
});

// Allow traffic from VPC CIDR (NLB is within VPC)
serviceSecurityGroup.addIngressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(appPort),
  'Allow traffic from NLB'
);

// Also allow from anywhere for public access
serviceSecurityGroup.addIngressRule(
  ec2.Peer.anyIpv4(),
  ec2.Port.tcp(appPort),
  'Allow public traffic through NLB'
);
```

## Use Cases

### When to Use NLB

✅ **High-performance applications**
- Gaming servers
- Streaming services
- Financial trading platforms
- Real-time bidding systems

✅ **TCP/UDP workloads**
- MQTT brokers
- Custom protocols
- Database connections

✅ **Static IP requirements**
- Third-party whitelisting
- Firewall rules
- DNS hardcoding

✅ **Preserving client IP**
- Security logging
- Geo-based routing
- Rate limiting

### When to Consider ALB Instead

❌ **HTTP-specific features needed**
- Path-based routing
- Host-based routing
- HTTP header manipulation
- WebSocket support (ALB has better support)

❌ **SSL/TLS termination at LB**
- ALB provides more SSL features
- SNI support
- Certificate management

❌ **Advanced routing**
- Content-based routing
- Request rewriting

## Migration from ALB

If you're migrating from a previous version that used ALB:

### 1. Update Your Application

NLB forwards raw TCP traffic, so your application doesn't need changes for basic functionality. However:

- If you were using HTTP-specific features at the LB level, move them to the application
- Update health checks from HTTP to TCP (or keep HTTP checks in your application)

### 2. Update Client Configuration

```bash
# Old ALB endpoint
http://my-alb-123456789.us-east-1.elb.amazonaws.com

# New NLB endpoint (similar format)
http://my-nlb-123456789.elb.us-east-1.amazonaws.com
```

### 3. Update DNS Records

If using Route53, update your DNS records to point to the new NLB:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "app.example.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z26RNL4JYFTOTI",
          "DNSName": "my-nlb-123456789.elb.us-east-1.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

## Monitoring

### CloudWatch Metrics

NLB provides different metrics than ALB:

```bash
# Active Flows (connections)
aws cloudwatch get-metric-statistics \
  --namespace AWS/NetworkELB \
  --metric-name ActiveFlowCount \
  --dimensions Name=LoadBalancer,Value=net/my-nlb/123456789 \
  --statistics Average \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T01:00:00Z \
  --period 300

# New Flows (new connections per second)
aws cloudwatch get-metric-statistics \
  --namespace AWS/NetworkELB \
  --metric-name NewFlowCount \
  --dimensions Name=LoadBalancer,Value=net/my-nlb/123456789 \
  --statistics Sum \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T01:00:00Z \
  --period 300

# Processed Bytes
aws cloudwatch get-metric-statistics \
  --namespace AWS/NetworkELB \
  --metric-name ProcessedBytes \
  --dimensions Name=LoadBalancer,Value=net/my-nlb/123456789 \
  --statistics Sum \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T01:00:00Z \
  --period 300
```

### Health Check Logs

Monitor NLB health checks in CloudWatch:

```bash
# View target health
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-target-group/123456789
```

## Cost Comparison

| Component | NLB | ALB |
|-----------|-----|-----|
| **Hourly Rate** | $0.0225/hour | $0.0225/hour |
| **LCU (Load Balancer Capacity Unit)** | Based on connections | Based on requests |
| **Small Traffic** | ~$16/month | ~$16/month |
| **High Traffic** | ~$50-100/month | ~$100-200/month |

**Note**: NLB is generally more cost-effective for high-throughput scenarios.

## Troubleshooting

### Target Health Check Failures

```bash
# Check target health
aws elbv2 describe-target-health \
  --target-group-arn $TARGET_GROUP_ARN

# Common issues:
# 1. Security group blocking NLB traffic
# 2. Application not listening on correct port
# 3. Health check port mismatch
```

### Connection Issues

```bash
# Test connectivity to NLB
telnet $NLB_DNS_NAME 80

# Check if application is responding
curl -v http://$NLB_DNS_NAME/health
```

### High Latency

- Enable cross-zone load balancing (already enabled by default)
- Check target response times
- Verify network path between NLB and targets

## Best Practices

1. **Enable Cross-Zone Load Balancing**
   ```typescript
   const cfnLB = networkLB.node.defaultChild as nlb.CfnLoadBalancer;
   cfnLB.addPropertyOverride('LoadBalancerAttributes', [
     { Key: 'load_balancing.cross_zone.enabled', Value: 'true' },
   ]);
   ```

2. **Use Deregistration Delay**
   ```typescript
   deregistrationDelay: cdk.Duration.seconds(30),
   ```

3. **Monitor Connection Metrics**
   - Track `ActiveFlowCount` for capacity planning
   - Monitor `NewFlowCount` for traffic spikes
   - Watch `TargetTLSNegotiationErrorCount` for SSL issues

4. **Preserve Source IP**
   - NLB preserves client IP by default
   - Access it in your application: `request.headers['x-forwarded-for']`

## Related Documentation

- [AWS NLB Documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html)
- [NLB vs ALB Comparison](https://aws.amazon.com/elasticloadbalancing/features/)
- [NLB Pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
- [NLB CloudWatch Metrics](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/network-load-balancer-cloudwatch-metrics.html)
