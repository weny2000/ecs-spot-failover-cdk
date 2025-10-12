# ECS Fargate Spot Failover System - Operations Manual

## Overview

This operations manual provides comprehensive guidance for the day-to-day management, monitoring, and maintenance of the ECS Fargate Spot Failover System. It serves as the primary reference for operations teams responsible for system reliability and performance.

## System Architecture Quick Reference

### Core Components
- **ECS Cluster**: `fargate-spot-cluster`
- **Lambda Functions**: 4 functions for error detection, failover, monitoring, and cleanup
- **DynamoDB Table**: `fargate-spot-error-counter`
- **EventBridge Rules**: 2 rules for task state monitoring
- **SNS Topic**: `fargate-spot-failover-notifications`

### Service Naming Convention
- **Spot Service**: `{service-name}` (e.g., `sample-app`)
- **Standard Service**: `{service-name}-standard` (e.g., `sample-app-standard`)

## Daily Operations

### Morning Health Check (15 minutes)

#### 1. System Status Overview
```bash
# Quick system status
./scripts/monitor-system.sh fargate-spot-cluster
```

**Expected Output**:
- All services showing desired task counts
- Error counters at zero or low values
- No active failover states

#### 2. Service Health Verification
```bash
# Check ECS services
aws ecs describe-services --cluster fargate-spot-cluster --services sample-app sample-app-standard

# Verify task health
aws ecs list-tasks --cluster fargate-spot-cluster --service-name sample-app
```

**Health Indicators**:
- ✅ `runningCount` equals `desiredCount`
- ✅ `pendingCount` is zero
- ✅ Tasks in `RUNNING` state
- ✅ No recent task failures

#### 3. Error Counter Review
```bash
# Check DynamoDB error counters
aws dynamodb scan --table-name fargate-spot-error-counter --projection-expression "service_name, error_count, last_error_time, failover_state"
```

**Normal State**:
- Error counts: 0-2 (acceptable range)
- No active failover states
- Recent success timestamps

#### 4. Lambda Function Health
```bash
# Check Lambda function status
aws lambda list-functions --query 'Functions[?contains(FunctionName, `EcsFargateSpotFailover`)].{Name:FunctionName,State:State,LastModified:LastModified}'
```

**Expected State**: All functions in `Active` state

### Evening Review (10 minutes)

#### 1. Daily Metrics Summary
```bash
# Get CloudWatch metrics for the day
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name RunningCount \
  --dimensions Name=ServiceName,Value=sample-app Name=ClusterName,Value=fargate-spot-cluster \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Average,Maximum,Minimum
```

#### 2. Review Notifications
- Check SNS delivery reports
- Review any error notifications
- Verify notification delivery to stakeholders

#### 3. Log Review
```bash
# Check for any errors in Lambda logs
aws logs filter-log-events \
  --log-group-name "/aws/lambda/EcsFargateSpotFailoverStack-SpotErrorDetector" \
  --start-time $(date -d '24 hours ago' +%s)000 \
  --filter-pattern "ERROR"
```

## Weekly Operations

### Monday: System Performance Review

#### 1. Performance Metrics Analysis
```bash
# Lambda function performance
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=EcsFargateSpotFailoverStack-SpotErrorDetector \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Average,Maximum
```

#### 2. Cost Analysis
- Review Spot vs Standard instance usage
- Calculate cost savings
- Analyze failover frequency impact on costs

#### 3. Capacity Planning
- Review service scaling patterns
- Assess resource utilization
- Plan for capacity adjustments

### Wednesday: Security and Compliance Check

#### 1. IAM Role Review
```bash
# Check Lambda execution role permissions
aws iam get-role --role-name EcsFargateSpotFailoverStack-LambdaExecutionRole
aws iam list-attached-role-policies --role-name EcsFargateSpotFailoverStack-LambdaExecutionRole
```

#### 2. Network Security Validation
```bash
# Check security group configurations
aws ec2 describe-security-groups --filters "Name=group-name,Values=*EcsFargateSpotFailover*"

# Verify VPC configuration
aws ec2 describe-vpcs --filters "Name=tag:Name,Values=*EcsFargateSpotFailover*"
```

#### 3. Access Log Review
```bash
# Review CloudTrail logs for API calls
aws logs filter-log-events \
  --log-group-name CloudTrail/ECSFargateSpotFailover \
  --start-time $(date -d '7 days ago' +%s)000 \
  --filter-pattern "{ $.eventSource = ecs.amazonaws.com || $.eventSource = lambda.amazonaws.com }"
```

### Friday: Maintenance and Updates

#### 1. System Updates Check
```bash
# Check for CDK updates
npm outdated

# Check for Lambda runtime updates
aws lambda list-functions --query 'Functions[?contains(FunctionName, `EcsFargateSpotFailover`)].{Name:FunctionName,Runtime:Runtime}'
```

#### 2. Backup Verification
```bash
# Verify DynamoDB backup
aws dynamodb describe-continuous-backups --table-name fargate-spot-error-counter

# Export current configuration
aws ecs describe-services --cluster fargate-spot-cluster > backup/weekly-backup-$(date +%Y%m%d).json
```

#### 3. Documentation Updates
- Review and update operational procedures
- Update contact information
- Verify escalation procedures

## Monitoring and Alerting

### Key Metrics to Monitor

#### 1. System Health Metrics
- **Service Availability**: Percentage of time services are running
- **Task Success Rate**: Percentage of successful task launches
- **Failover Frequency**: Number of failovers per day/week
- **Recovery Time**: Time to recover from failures

#### 2. Performance Metrics
- **Lambda Execution Duration**: Average and maximum execution times
- **DynamoDB Response Time**: Read/write latency
- **ECS Task Launch Time**: Time from task creation to running state
- **EventBridge Rule Processing**: Event processing latency

#### 3. Cost Metrics
- **Spot Instance Savings**: Cost difference between Spot and Standard
- **Lambda Execution Costs**: Monthly Lambda usage costs
- **DynamoDB Costs**: Read/write capacity costs
- **Overall System Costs**: Total monthly operational costs

### Alert Configuration

#### Critical Alerts (Immediate Response Required)
```bash
# High error rate alert
aws cloudwatch put-metric-alarm \
  --alarm-name "ECS-Spot-High-Error-Rate" \
  --alarm-description "High error rate in Spot instances" \
  --metric-name ErrorCount \
  --namespace ECS/SpotFailover \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

#### Warning Alerts (Response Within 1 Hour)
- Lambda function errors
- DynamoDB throttling
- Service deployment failures
- Notification delivery failures

#### Informational Alerts (Response Within 4 Hours)
- Performance degradation
- Cost threshold exceeded
- Capacity warnings
- Configuration drift

### Monitoring Dashboard Setup

#### CloudWatch Dashboard Configuration
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ECS", "RunningCount", "ServiceName", "sample-app", "ClusterName", "fargate-spot-cluster"],
          ["AWS/ECS", "RunningCount", "ServiceName", "sample-app-standard", "ClusterName", "fargate-spot-cluster"]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "ECS Service Running Count"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Duration", "FunctionName", "EcsFargateSpotFailoverStack-SpotErrorDetector"],
          ["AWS/Lambda", "Errors", "FunctionName", "EcsFargateSpotFailoverStack-SpotErrorDetector"]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Lambda Function Performance"
      }
    }
  ]
}
```

## Incident Response Procedures

### Incident Classification

#### Severity 1 (Critical)
- Complete system failure
- Data loss or corruption
- Security breach
- Service unavailable > 15 minutes

**Response Time**: 15 minutes
**Escalation**: Immediate management notification

#### Severity 2 (High)
- Partial system failure
- Performance degradation > 50%
- Failover mechanism not working
- Service unavailable 5-15 minutes

**Response Time**: 1 hour
**Escalation**: Team lead notification

#### Severity 3 (Medium)
- Minor functionality issues
- Performance degradation < 50%
- Non-critical component failures
- Service unavailable < 5 minutes

**Response Time**: 4 hours
**Escalation**: Standard team notification

#### Severity 4 (Low)
- Cosmetic issues
- Documentation problems
- Enhancement requests
- No service impact

**Response Time**: 24 hours
**Escalation**: Next business day

### Incident Response Steps

#### 1. Initial Response (First 15 minutes)
1. **Acknowledge** the incident
2. **Assess** the severity and impact
3. **Notify** appropriate stakeholders
4. **Begin** initial investigation

#### 2. Investigation and Diagnosis (15-60 minutes)
```bash
# Quick diagnostic commands
./scripts/monitor-system.sh fargate-spot-cluster

# Check recent logs
aws logs filter-log-events \
  --log-group-name "/aws/lambda/EcsFargateSpotFailoverStack-SpotErrorDetector" \
  --start-time $(date -d '1 hour ago' +%s)000

# Verify service status
aws ecs describe-services --cluster fargate-spot-cluster --services sample-app sample-app-standard
```

#### 3. Immediate Mitigation (As needed)
```bash
# Manual failover if automatic fails
aws ecs update-service --cluster fargate-spot-cluster --service sample-app --desired-count 0
aws ecs update-service --cluster fargate-spot-cluster --service sample-app-standard --desired-count 2

# Restart Lambda functions if needed
aws lambda update-function-configuration --function-name EcsFargateSpotFailoverStack-SpotErrorDetector --timeout 300
```

#### 4. Resolution and Recovery
- Implement permanent fix
- Verify system functionality
- Monitor for stability
- Update documentation

#### 5. Post-Incident Review
- Document root cause
- Identify prevention measures
- Update procedures
- Communicate lessons learned

## Troubleshooting Guide

### Common Issues and Solutions

#### Issue: Failover Not Triggering
**Symptoms**:
- Spot instances failing repeatedly
- Error counter increasing but no failover
- Standard service not starting

**Diagnostic Steps**:
```bash
# Check EventBridge rules
aws events list-rules --query 'Rules[?contains(Name, `EcsFargateSpotFailover`)].{Name:Name,State:State}'

# Verify Lambda function permissions
aws lambda get-policy --function-name EcsFargateSpotFailoverStack-SpotErrorDetector

# Check error counter threshold
aws dynamodb get-item --table-name fargate-spot-error-counter --key '{"service_name":{"S":"sample-app"}}'
```

**Solutions**:
1. Verify EventBridge rule is enabled
2. Check Lambda function permissions
3. Validate error detection logic
4. Adjust failure threshold if needed

#### Issue: Services Not Switching
**Symptoms**:
- Failover triggered but services unchanged
- Both services running simultaneously
- Inconsistent service states

**Diagnostic Steps**:
```bash
# Check ECS service permissions
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::ACCOUNT:role/EcsFargateSpotFailoverStack-LambdaExecutionRole \
  --action-names ecs:UpdateService \
  --resource-arns arn:aws:ecs:REGION:ACCOUNT:service/fargate-spot-cluster/sample-app

# Verify service configurations
aws ecs describe-services --cluster fargate-spot-cluster --services sample-app sample-app-standard
```

**Solutions**:
1. Verify Lambda execution role permissions
2. Check service configurations
3. Ensure backup services exist
4. Validate cluster capacity

#### Issue: High False Positive Rate
**Symptoms**:
- Frequent unnecessary failovers
- Spot services switching too often
- High operational costs

**Diagnostic Steps**:
```bash
# Analyze error patterns
aws dynamodb scan --table-name fargate-spot-error-counter --projection-expression "service_name, error_count, last_error_time"

# Review Lambda logs for error detection
aws logs filter-log-events \
  --log-group-name "/aws/lambda/EcsFargateSpotFailoverStack-SpotErrorDetector" \
  --start-time $(date -d '24 hours ago' +%s)000 \
  --filter-pattern "Detected Spot instance error"
```

**Solutions**:
1. Adjust failure threshold
2. Refine error detection patterns
3. Implement error filtering logic
4. Add delay before failover

### Performance Optimization

#### Lambda Function Optimization
```bash
# Monitor Lambda performance
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=EcsFargateSpotFailoverStack-SpotErrorDetector \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Average,Maximum
```

**Optimization Strategies**:
- Increase memory allocation for faster execution
- Optimize code for reduced cold starts
- Use connection pooling for AWS services
- Implement caching where appropriate

#### DynamoDB Optimization
```bash
# Monitor DynamoDB performance
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=fargate-spot-error-counter \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

**Optimization Strategies**:
- Use on-demand billing for variable workloads
- Implement efficient query patterns
- Consider DynamoDB Accelerator (DAX) for high-read workloads
- Optimize item structure and access patterns

## Maintenance Procedures

### Monthly Maintenance

#### 1. System Health Assessment
- Review all monitoring metrics
- Analyze performance trends
- Identify optimization opportunities
- Plan capacity adjustments

#### 2. Security Review
- Update IAM policies if needed
- Review access logs
- Validate security group configurations
- Check for security updates

#### 3. Cost Optimization
- Analyze cost trends
- Review resource utilization
- Optimize instance types and sizes
- Implement cost-saving measures

#### 4. Documentation Updates
- Update operational procedures
- Review and update contact information
- Validate escalation procedures
- Update system diagrams

### Quarterly Maintenance

#### 1. Disaster Recovery Testing
```bash
# Test backup and restore procedures
aws dynamodb create-backup --table-name fargate-spot-error-counter --backup-name quarterly-test-backup

# Test failover scenarios
./scripts/test-failover.sh fargate-spot-cluster sample-app
```

#### 2. Performance Benchmarking
- Establish performance baselines
- Compare against previous quarters
- Identify performance degradation
- Plan performance improvements

#### 3. Capacity Planning Review
- Analyze growth trends
- Plan for future capacity needs
- Review scaling policies
- Update resource allocations

#### 4. Technology Updates
- Review AWS service updates
- Plan for runtime upgrades
- Evaluate new features
- Schedule update implementations

## Contact Information and Escalation

### Primary Contacts
- **Operations Team Lead**: [Name] - [Email] - [Phone]
- **Development Team Lead**: [Name] - [Email] - [Phone]
- **System Administrator**: [Name] - [Email] - [Phone]
- **Security Officer**: [Name] - [Email] - [Phone]

### Escalation Matrix
| Severity | Initial Contact | Escalation 1 | Escalation 2 | Escalation 3 |
|----------|----------------|--------------|--------------|--------------|
| 1 (Critical) | Operations Lead | Development Lead | Management | Executive |
| 2 (High) | Operations Team | Operations Lead | Development Lead | Management |
| 3 (Medium) | On-call Engineer | Operations Team | Operations Lead | Development Lead |
| 4 (Low) | Ticket System | On-call Engineer | Operations Team | Operations Lead |

### Emergency Procedures
- **24/7 Hotline**: [Phone Number]
- **Emergency Email**: [Email Address]
- **Incident Management System**: [URL]
- **Status Page**: [URL]

---

**Document Version**: 1.0  
**Last Updated**: [Current Date]  
**Next Review**: [Review Date]  
**Document Owner**: Operations Team