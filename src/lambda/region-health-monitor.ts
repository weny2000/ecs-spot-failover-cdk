/**
 * Region Health Monitor Lambda Function
 * 
 * Purpose: Monitor health of all deployed regions and orchestrate cross-region failover
 * when primary region experiences widespread issues (not just Spot capacity).
 * 
 * Trigger: EventBridge Scheduled Rule (every 30 seconds)
 * 
 * Features:
 * - Multi-region health checks via CloudWatch metrics
 * - Automatic Route53 DNS failover
 * - Cross-region state synchronization via DynamoDB Global Tables
 * - Intelligent failover decision making
 * - Automatic failback when primary recovers
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Route53Client, ChangeResourceRecordSetsCommand, GetHealthCheckStatusCommand, ListHealthChecksCommand } from '@aws-sdk/client-route-53';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { ECSClient, DescribeServicesCommand, DescribeClustersCommand } from '@aws-sdk/client-ecs';
import * as AWSXRay from 'aws-xray-sdk-core';

// Enable X-Ray tracing
const dynamodbClient = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const cloudWatchClient = AWSXRay.captureAWSv3Client(new CloudWatchClient({}));
const route53Client = AWSXRay.captureAWSv3Client(new Route53Client({}));
const snsClient = AWSXRay.captureAWSv3Client(new SNSClient({}));
const ecsClient = AWSXRay.captureAWSv3Client(new ECSClient({}));

// Environment variables
const HEALTH_CHECK_TABLE = process.env.HEALTH_CHECK_TABLE || 'region-health-checks';
const GLOBAL_STATE_TABLE = process.env.GLOBAL_STATE_TABLE || 'global-failover-state';
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;
const ROUTE53_HOSTED_ZONE_ID = process.env.ROUTE53_HOSTED_ZONE_ID;
const DNS_RECORD_NAME = process.env.DNS_RECORD_NAME || 'app.example.com';
const PRIMARY_REGION = process.env.PRIMARY_REGION || 'us-east-1';
const SECONDARY_REGIONS = (process.env.SECONDARY_REGIONS || 'us-west-2').split(',');
const ALL_REGIONS = [PRIMARY_REGION, ...SECONDARY_REGIONS];
const FAILOVER_THRESHOLD = parseInt(process.env.FAILOVER_THRESHOLD || '3');
const RECOVERY_THRESHOLD = parseInt(process.env.RECOVERY_THRESHOLD || '2');
const HEALTH_CHECK_INTERVAL = parseInt(process.env.HEALTH_CHECK_INTERVAL || '30');

// Type definitions
interface RegionHealth {
  region: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'failed';
  timestamp: string;
  checks: {
    nlbHealthy: boolean;
    ecsServicesHealthy: boolean;
    spotCapacityAvailable: boolean;
    errorRateAcceptable: boolean;
    dynamoDBReachable: boolean;
  };
  metrics: {
    errorRate: number;
    responseTime: number;
    spotFailureCount: number;
    healthyTaskCount: number;
  };
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

interface GlobalFailoverState {
  primaryRegion: string;
  activeRegion: string;
  failoverStatus: 'normal' | 'failing_over' | 'failed_over' | 'recovering';
  lastFailoverTime?: string;
  lastFailbackTime?: string;
  failoverReason?: string;
  failoverCount: number;
}

interface LambdaResponse {
  statusCode: number;
  body: string;
}

/**
 * Check NLB health by querying CloudWatch metrics
 */
async function checkNLBHealth(region: string): Promise<{ healthy: boolean; metric: number }> {
  try {
    // Query NLB TCP connection error rate
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 2 * 60 * 1000); // 2 minutes ago

    const response = await cloudWatchClient.send(new GetMetricStatisticsCommand({
      Namespace: 'AWS/ApplicationELB',
      MetricName: 'HTTPCode_Target_5XX_Count',
      Dimensions: [
        { Name: 'LoadBalancer', Value: `net/${region}-nlb` }, // This needs to be configured
      ],
      StartTime: startTime,
      EndTime: endTime,
      Period: 60,
      Statistics: ['Sum'],
    }));

    const dataPoints = response.Datapoints || [];
    const total5xx = dataPoints.reduce((sum, dp) => sum + (dp.Sum || 0), 0);
    
    // Also get request count to calculate error rate
    const requestResponse = await cloudWatchClient.send(new GetMetricStatisticsCommand({
      Namespace: 'AWS/ApplicationELB',
      MetricName: 'RequestCount',
      Dimensions: [
        { Name: 'LoadBalancer', Value: `net/${region}-nlb` },
      ],
      StartTime: startTime,
      EndTime: endTime,
      Period: 60,
      Statistics: ['Sum'],
    }));

    const requestCount = (requestResponse.Datapoints || []).reduce((sum, dp) => sum + (dp.Sum || 0), 0);
    const errorRate = requestCount > 0 ? total5xx / requestCount : 0;

    return {
      healthy: errorRate < 0.1, // Less than 10% error rate
      metric: errorRate,
    };
  } catch (error) {
    console.error(`Failed to check NLB health for ${region}:`, error);
    return { healthy: false, metric: 1 };
  }
}

/**
 * Check ECS service health
 */
async function checkECSHealth(region: string): Promise<{ healthy: boolean; healthyTaskCount: number }> {
  try {
    // Check cluster status
    const clusterResponse = await ecsClient.send(new DescribeClustersCommand({
      clusters: ['fargate-spot-cluster'],
    }));

    const cluster = clusterResponse.clusters?.[0];
    if (!cluster || cluster.status !== 'ACTIVE') {
      return { healthy: false, healthyTaskCount: 0 };
    }

    // Check service status
    const servicesResponse = await ecsClient.send(new DescribeServicesCommand({
      cluster: 'fargate-spot-cluster',
      services: ['sample-app', 'sample-app-standard'],
    }));

    let healthyTaskCount = 0;
    let allServicesHealthy = true;

    for (const service of servicesResponse.services || []) {
      if (service.status !== 'ACTIVE') {
        allServicesHealthy = false;
      }
      healthyTaskCount += service.runningCount || 0;
    }

    return {
      healthy: allServicesHealthy && healthyTaskCount > 0,
      healthyTaskCount,
    };
  } catch (error) {
    console.error(`Failed to check ECS health for ${region}:`, error);
    return { healthy: false, healthyTaskCount: 0 };
  }
}

/**
 * Check Spot capacity availability via custom metrics
 */
async function checkSpotCapacity(region: string): Promise<{ available: boolean; failureCount: number }> {
  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 5 * 60 * 1000); // 5 minutes ago

    const response = await cloudWatchClient.send(new GetMetricStatisticsCommand({
      Namespace: 'ECS/FargateSpotFailover',
      MetricName: 'SpotErrorCount',
      StartTime: startTime,
      EndTime: endTime,
      Period: 60,
      Statistics: ['Maximum'],
    }));

    const dataPoints = response.Datapoints || [];
    const maxErrorCount = dataPoints.length > 0 
      ? Math.max(...dataPoints.map(dp => dp.Maximum || 0))
      : 0;

    return {
      available: maxErrorCount < FAILOVER_THRESHOLD,
      failureCount: maxErrorCount,
    };
  } catch (error) {
    console.error(`Failed to check Spot capacity for ${region}:`, error);
    return { available: false, failureCount: 999 };
  }
}

/**
 * Check DynamoDB connectivity
 */
async function checkDynamoDBHealth(region: string): Promise<boolean> {
  try {
    // Try to read from the health check table
    await dynamodb.send(new GetCommand({
      TableName: HEALTH_CHECK_TABLE,
      Key: { region, timestamp: 'latest' },
    }));
    return true;
  } catch (error: any) {
    // Item not found is OK, other errors indicate problem
    if (error.name === 'ResourceNotFoundException') {
      return false;
    }
    return true; // Other errors might be permissions, but connection works
  }
}

/**
 * Perform comprehensive health check for a region
 */
async function performHealthCheck(region: string): Promise<RegionHealth> {
  const segment = AWSXRay.getSegment()?.addNewSubsegment(`healthCheck-${region}`);
  
  try {
    const [nlbHealth, ecsHealth, spotCapacity, dynamoDBHealth] = await Promise.all([
      checkNLBHealth(region),
      checkECSHealth(region),
      checkSpotCapacity(region),
      checkDynamoDBHealth(region),
    ]);

    const checks = {
      nlbHealthy: nlbHealth.healthy,
      ecsServicesHealthy: ecsHealth.healthy,
      spotCapacityAvailable: spotCapacity.available,
      errorRateAcceptable: nlbHealth.metric < 0.05,
      dynamoDBReachable: dynamoDBHealth,
    };

    // Determine overall status
    const failedChecks = Object.values(checks).filter(v => !v).length;
    let status: RegionHealth['status'] = 'healthy';
    if (failedChecks >= 4) status = 'failed';
    else if (failedChecks >= 2) status = 'unhealthy';
    else if (failedChecks >= 1) status = 'degraded';

    const health: RegionHealth = {
      region,
      status,
      timestamp: new Date().toISOString(),
      checks,
      metrics: {
        errorRate: nlbHealth.metric,
        responseTime: 0, // Could be added with custom metrics
        spotFailureCount: spotCapacity.failureCount,
        healthyTaskCount: ecsHealth.healthyTaskCount,
      },
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    };

    segment?.addMetadata('healthStatus', status);
    segment?.addMetadata('failedChecks', failedChecks);
    
    return health;
  } finally {
    segment?.close();
  }
}

/**
 * Get previous health record to track consecutive failures
 */
async function getPreviousHealth(region: string): Promise<RegionHealth | null> {
  try {
    const result = await dynamodb.send(new GetCommand({
      TableName: HEALTH_CHECK_TABLE,
      Key: { region, timestamp: 'latest' },
    }));
    return result.Item as RegionHealth || null;
  } catch (error) {
    return null;
  }
}

/**
 * Update health check record
 */
async function updateHealthRecord(health: RegionHealth): Promise<void> {
  // Store detailed record with timestamp
  await dynamodb.send(new PutCommand({
    TableName: HEALTH_CHECK_TABLE,
    Item: {
      ...health,
      ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hour TTL
    },
  }));

  // Update latest record
  await dynamodb.send(new PutCommand({
    TableName: HEALTH_CHECK_TABLE,
    Item: {
      ...health,
      timestamp: 'latest',
    },
  }));
}

/**
 * Get global failover state
 */
async function getGlobalFailoverState(): Promise<GlobalFailoverState> {
  try {
    const result = await dynamodb.send(new GetCommand({
      TableName: GLOBAL_STATE_TABLE,
      Key: { stateId: 'global' },
    }));

    if (result.Item) {
      return result.Item as GlobalFailoverState;
    }
  } catch (error) {
    console.log('No existing global state found, creating default');
  }

  // Default state
  return {
    primaryRegion: PRIMARY_REGION,
    activeRegion: PRIMARY_REGION,
    failoverStatus: 'normal',
    failoverCount: 0,
  };
}

/**
 * Update global failover state
 */
async function updateGlobalFailoverState(state: GlobalFailoverState): Promise<void> {
  await dynamodb.send(new PutCommand({
    TableName: GLOBAL_STATE_TABLE,
    Item: {
      stateId: 'global',
      ...state,
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Execute Route53 DNS failover
 */
async function executeDNSFailover(fromRegion: string, toRegion: string): Promise<void> {
  if (!ROUTE53_HOSTED_ZONE_ID) {
    console.log('Route53 Hosted Zone ID not configured, skipping DNS failover');
    return;
  }

  try {
    console.log(`Executing DNS failover from ${fromRegion} to ${toRegion}`);

    // Get NLB DNS for target region (this would be stored or retrieved)
    const targetDNS = `${toRegion}-nlb.amazonaws.com`;

    await route53Client.send(new ChangeResourceRecordSetsCommand({
      HostedZoneId: ROUTE53_HOSTED_ZONE_ID,
      ChangeBatch: {
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: DNS_RECORD_NAME,
              Type: 'A',
              AliasTarget: {
                HostedZoneId: ROUTE53_HOSTED_ZONE_ID,
                DNSName: targetDNS,
                EvaluateTargetHealth: true,
              },
            },
          },
        ],
      },
    }));

    console.log(`DNS failover completed: ${DNS_RECORD_NAME} -> ${targetDNS}`);
  } catch (error) {
    console.error('Failed to execute DNS failover:', error);
    throw error;
  }
}

/**
 * Send notification about failover event
 */
async function sendNotification(subject: string, message: string): Promise<void> {
  if (!NOTIFICATION_TOPIC_ARN) return;

  try {
    await snsClient.send(new PublishCommand({
      TopicArn: NOTIFICATION_TOPIC_ARN,
      Subject: subject,
      Message: message,
    }));
  } catch (error) {
    console.error('Failed to send notification:', error);
  }
}

/**
 * Decide and execute failover if needed
 */
async function evaluateAndExecuteFailover(
  regionHealths: RegionHealth[],
  globalState: GlobalFailoverState
): Promise<GlobalFailoverState> {
  const primaryHealth = regionHealths.find(h => h.region === PRIMARY_REGION);
  const secondaryHealths = regionHealths.filter(h => h.region !== PRIMARY_REGION);
  
  const newState = { ...globalState };

  // Check if we need to failover FROM primary
  if (globalState.activeRegion === PRIMARY_REGION && primaryHealth) {
    if (primaryHealth.status === 'failed' || primaryHealth.consecutiveFailures >= FAILOVER_THRESHOLD) {
      // Find best secondary region
      const bestSecondary = secondaryHealths
        .filter(h => h.status === 'healthy' || h.status === 'degraded')
        .sort((a, b) => b.metrics.healthyTaskCount - a.metrics.healthyTaskCount)[0];

      if (bestSecondary) {
        console.log(`🚨 Initiating failover from ${PRIMARY_REGION} to ${bestSecondary.region}`);
        
        newState.activeRegion = bestSecondary.region;
        newState.failoverStatus = 'failing_over';
        newState.lastFailoverTime = new Date().toISOString();
        newState.failoverReason = `Primary region ${PRIMARY_REGION} failed: ${primaryHealth.status}`;
        newState.failoverCount++;

        // Execute DNS failover
        await executeDNSFailover(PRIMARY_REGION, bestSecondary.region);

        // Send notification
        await sendNotification(
          '🚨 Multi-Region Failover Triggered',
          `Primary region ${PRIMARY_REGION} has failed.\n` +
          `Failing over to: ${bestSecondary.region}\n` +
          `Time: ${newState.lastFailoverTime}\n` +
          `Reason: ${newState.failoverReason}\n\n` +
          `Primary metrics:\n` +
          `- Status: ${primaryHealth.status}\n` +
          `- Error rate: ${(primaryHealth.metrics.errorRate * 100).toFixed(2)}%\n` +
          `- Healthy tasks: ${primaryHealth.metrics.healthyTaskCount}\n` +
          `- Spot failures: ${primaryHealth.metrics.spotFailureCount}`
        );

        newState.failoverStatus = 'failed_over';
      } else {
        console.error('❌ Primary region failed but no healthy secondary available!');
        await sendNotification(
          '🔴 CRITICAL: No Healthy Secondary Region',
          `Primary region ${PRIMARY_REGION} has failed and no healthy secondary region is available!`
        );
      }
    }
  }

  // Check if we can failback to primary
  if (globalState.activeRegion !== PRIMARY_REGION && primaryHealth) {
    const isPrimaryRecovered = 
      primaryHealth.status === 'healthy' && 
      primaryHealth.consecutiveSuccesses >= RECOVERY_THRESHOLD;

    if (isPrimaryRecovered) {
      console.log(`✅ Primary region ${PRIMARY_REGION} recovered, initiating failback`);
      
      newState.activeRegion = PRIMARY_REGION;
      newState.failoverStatus = 'recovering';
      newState.lastFailbackTime = new Date().toISOString();

      // Execute DNS failback
      await executeDNSFailover(globalState.activeRegion, PRIMARY_REGION);

      await sendNotification(
        '✅ Multi-Region Failback Completed',
        `Primary region ${PRIMARY_REGION} has recovered.\n` +
        `Traffic has been routed back to primary.\n` +
        `Time: ${newState.lastFailbackTime}\n\n` +
        `Primary metrics:\n` +
        `- Status: ${primaryHealth.status}\n` +
        `- Error rate: ${(primaryHealth.metrics.errorRate * 100).toFixed(2)}%\n` +
        `- Healthy tasks: ${primaryHealth.metrics.healthyTaskCount}`
      );

      newState.failoverStatus = 'normal';
    }
  }

  return newState;
}

/**
 * Lambda handler
 */
export const handler = async (): Promise<LambdaResponse> => {
  const segment = AWSXRay.getSegment();
  segment?.addAnnotation('functionName', 'RegionHealthMonitor');

  console.log('🌐 Starting multi-region health check...');
  console.log(`Regions: ${ALL_REGIONS.join(', ')}`);
  console.log(`Primary: ${PRIMARY_REGION}`);

  try {
    // Get current global state
    const globalState = await getGlobalFailoverState();
    console.log('Current global state:', JSON.stringify(globalState, null, 2));

    // Perform health checks for all regions
    const healthChecks: RegionHealth[] = [];
    for (const region of ALL_REGIONS) {
      const health = await performHealthCheck(region);
      
      // Get previous health for consecutive tracking
      const previous = await getPreviousHealth(region);
      if (previous) {
        if (health.status === 'failed' || health.status === 'unhealthy') {
          health.consecutiveFailures = previous.consecutiveFailures + 1;
          health.consecutiveSuccesses = 0;
        } else {
          health.consecutiveSuccesses = previous.consecutiveSuccesses + 1;
          health.consecutiveFailures = 0;
        }
      }

      healthChecks.push(health);
      await updateHealthRecord(health);
      
      console.log(`${region}: ${health.status} (failures: ${health.consecutiveFailures}, successes: ${health.consecutiveSuccesses})`);
    }

    // Evaluate and execute failover if needed
    const newState = await evaluateAndExecuteFailover(healthChecks, globalState);
    
    if (newState.activeRegion !== globalState.activeRegion ||
        newState.failoverStatus !== globalState.failoverStatus) {
      await updateGlobalFailoverState(newState);
      console.log('Updated global state:', JSON.stringify(newState, null, 2));
    }

    // Publish CloudWatch metrics
    for (const health of healthChecks) {
      // This would be implemented with PutMetricData
      // Metric: RegionHealthScore per region
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Multi-region health check completed',
        timestamp: new Date().toISOString(),
        activeRegion: newState.activeRegion,
        failoverStatus: newState.failoverStatus,
        regionHealths: healthChecks.map(h => ({
          region: h.region,
          status: h.status,
          consecutiveFailures: h.consecutiveFailures,
        })),
      }),
    };

  } catch (error) {
    console.error('❌ Health monitor failed:', error);
    
    await sendNotification(
      '❌ Multi-Region Health Monitor Error',
      `Error: ${(error as Error).message}\nTime: ${new Date().toISOString()}`
    );

    throw error;
  }
};
