# X-Ray Tracing Guide

This document describes how AWS X-Ray tracing is implemented in the ECS Fargate Spot Failover solution.

## Overview

X-Ray tracing is enabled for:
- **Lambda Functions**: Spot Error Detector, Spot Success Monitor
- **Step Functions**: Failover and Cleanup workflows
- **AWS SDK Calls**: All AWS service calls are traced

## X-Ray Service Map

The service map shows the flow of requests through your application:

```
EventBridge → SpotErrorDetector → DynamoDB
                           ↓
                    Step Functions → ECS
                           ↓
                          SNS
                           ↓
                    CloudWatch Metrics
```

## Accessing X-Ray Traces

### AWS Console
1. Navigate to X-Ray Service Map: `https://console.aws.amazon.com/xray/home`
2. View traces and service map

### CLI
```bash
# Get trace summaries
aws xray get-trace-summaries \
  --start-time $(date -d '1 hour ago' +%s) \
  --end-time $(date +%s) \
  --filter-expression 'service("SpotErrorDetector")'

# Get service graph
aws xray get-service-graph \
  --start-time $(date -d '1 hour ago' +%s) \
  --end-time $(date +%s)
```

### CloudWatch ServiceLens
X-Ray integrates with CloudWatch ServiceLens for unified observability.

## Traced Components

### Lambda Functions
Each Lambda function creates a trace segment with:
- Function name and version
- Invocation time
- Cold start indicators
- Custom annotations and metadata

**Annotations (indexed for search):**
- `serviceName` - The ECS service being monitored
- `functionName` - Lambda function name
- `stoppedReason` - For error detector (e.g., SpotInterruption)
- `success` - Whether the function succeeded

**Metadata (not indexed):**
- `eventSource` - Source of the triggering event
- `processingLatency` - Time taken to process
- `errorCount` - Current error count

### Step Functions
Step Functions workflows are traced with:
- State transitions
- Task execution times
- Error states
- Retry attempts

### AWS SDK Calls
All AWS SDK calls are traced as subsegments:
- `DynamoDB` - GetItem, UpdateItem, PutItem
- `SNS` - Publish
- `ECS` - DescribeServices, UpdateService
- `Step Functions` - StartExecution
- `CloudWatch` - PutMetricData

## Custom Subsegments

The Lambda functions create custom subsegments for:
- `updateErrorCount` - DynamoDB error count update
- `getServiceState` - Retrieve current service state
- `resetErrorCount` - Reset error counter
- `triggerFailover` - Start Step Functions execution
- `triggerCleanup` - Start cleanup workflow
- `sendNotification` - SNS notification
- `publishCloudWatchMetric` - Custom metric publishing

## Sampling Configuration

By default, X-Ray samples:
- First request each second
- 5% of additional requests

For high-traffic scenarios, you may want to adjust sampling rules in the X-Ray console.

## Troubleshooting with X-Ray

### High Latency
Check the service map for:
- Slow downstream services
- DynamoDB throttling
- ECS API delays

### Errors
Trace error propagation:
1. Find error traces in X-Ray console
2. Examine exception stack traces
3. Check downstream service health

### Missing Traces
If traces are missing:
1. Verify IAM permissions for X-Ray
2. Check X-Ray daemon is running (for ECS tasks)
3. Ensure tracing is enabled on resources

## Cost Considerations

X-Ray charges based on:
- Traces recorded
- Traces retrieved
- Traces scanned

Default sampling (5%) helps control costs. Adjust based on your needs.

## Security

X-Ray traces may contain sensitive information:
- Request parameters
- Response data
- Custom metadata

Use encryption at rest and appropriate IAM policies to protect trace data.

## Best Practices

1. **Use Annotations for Search**: Index important values for filtering
2. **Minimize Metadata**: Don't log sensitive data in metadata
3. **Custom Subsegments**: Break down complex operations
4. **Error Handling**: Always add errors to segments
5. **Sampling Strategy**: Balance visibility and cost
