/**
 * Spot Success Monitor Lambda Function
 * 
 * Purpose: Monitor ECS task successful startup events, check failover state,
 * and trigger recovery process when Spot instances recover.
 * Trigger: EventBridge - ECS Task State Change (RUNNING)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import * as AWSXRay from 'aws-xray-sdk-core';

// Lazy initialization of AWS clients for testability
let dynamodb: DynamoDBDocumentClient;
let snsClient: SNSClient;
let sfnClient: SFNClient;
let cloudWatchClient: CloudWatchClient;

function getClients() {
  if (!dynamodb) {
    const dynamodbClient = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
    dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
  }
  if (!snsClient) {
    snsClient = AWSXRay.captureAWSv3Client(new SNSClient({}));
  }
  if (!sfnClient) {
    sfnClient = AWSXRay.captureAWSv3Client(new SFNClient({}));
  }
  if (!cloudWatchClient) {
    cloudWatchClient = AWSXRay.captureAWSv3Client(new CloudWatchClient({}));
  }
  return { dynamodb, snsClient, sfnClient, cloudWatchClient };
}

// Environment variables
const ERROR_COUNTER_TABLE = process.env.ERROR_COUNTER_TABLE || '';
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;
const CLUSTER_NAME = process.env.CLUSTER_NAME;
const NAMESPACE = process.env.CLOUDWATCH_NAMESPACE || 'ECS/FargateSpotFailover';

// Type definitions
interface FailoverState {
  failover_active: boolean;
}

interface ServiceState {
  error_count: number;
  failover_state: FailoverState | null;
  last_success_time: string | null;
}

interface EventDetail {
  clusterArn?: string;
  taskArn?: string;
  group?: string;
  lastStatus?: string;
  capacityProviderName?: string;
}

interface LambdaEvent {
  detail?: EventDetail;
}

interface LambdaResponse {
  statusCode: number;
  body: string;
}

/**
 * Send SNS notification
 * @param subject - Notification subject
 * @param message - Notification message
 */
async function sendNotification(subject: string, message: string): Promise<void> {
  if (!NOTIFICATION_TOPIC_ARN) return;

  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('sendNotification');
  try {
    const { snsClient } = getClients();
    await snsClient.send(new PublishCommand({
      TopicArn: NOTIFICATION_TOPIC_ARN,
      Subject: subject,
      Message: message
    }));
    console.log('Notification sent successfully');
    subsegment?.addAnnotation('notificationSent', true);
  } catch (error) {
    console.error('Failed to send notification:', error);
    subsegment?.addError(error as Error);
  } finally {
    subsegment?.close();
  }
}

/**
 * Publish CloudWatch metric
 * @param metricName - Name of the metric
 * @param value - Metric value
 * @param dimensions - Metric dimensions
 */
async function publishMetric(
  metricName: string, 
  value: number, 
  dimensions: { Name: string; Value: string }[] = []
): Promise<void> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('publishCloudWatchMetric');
  subsegment?.addMetadata('metricName', metricName);
  subsegment?.addMetadata('value', value);

  try {
    const { cloudWatchClient } = getClients();
    await cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: NAMESPACE,
      MetricData: [{
        MetricName: metricName,
        Value: value,
        Unit: 'Count',
        Dimensions: dimensions,
        Timestamp: new Date()
      }]
    }));
    subsegment?.addAnnotation('metricPublished', true);
  } catch (error) {
    console.error('Failed to publish CloudWatch metric:', error);
    subsegment?.addError(error as Error);
  } finally {
    subsegment?.close();
  }
}

/**
 * Extract service name from task group
 * @param group - Task group (e.g., service:my-service)
 * @returns Service name
 */
function extractServiceName(group: string | undefined): string {
  if (!group) return 'unknown-service';
  return group.replace('service:', '');
}

/**
 * Check if task is a Spot task
 * @param eventDetail - Event detail
 * @returns Whether it's a Spot task
 */
function isSpotTask(eventDetail: EventDetail): boolean {
  // Check capacityProviderName
  if (eventDetail.capacityProviderName === 'FARGATE_SPOT') {
    return true;
  }

  // Check task definition or tags
  if (eventDetail.group && eventDetail.group.includes('spot')) {
    return true;
  }

  return false;
}

/**
 * Get service error count and failover state
 * @param serviceName - Service name
 * @returns Service state
 */
async function getServiceState(serviceName: string): Promise<ServiceState> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('getServiceState');
  subsegment?.addMetadata('serviceName', serviceName);

  try {
    const { dynamodb } = getClients();
    const result = await dynamodb.send(new GetCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: serviceName }
    }));

    if (!result.Item) {
      subsegment?.addAnnotation('itemFound', false);
      subsegment?.close();
      return { error_count: 0, failover_state: null, last_success_time: null };
    }

    const state = {
      error_count: (result.Item.error_count as number) || 0,
      failover_state: (result.Item.failover_state as FailoverState) || null,
      last_success_time: (result.Item.last_success_time as string) || null
    };

    subsegment?.addMetadata('errorCount', state.error_count);
    subsegment?.addAnnotation('itemFound', true);
    subsegment?.close();
    return state;
  } catch (error) {
    console.error('Failed to get service state:', error);
    subsegment?.addError(error as Error);
    subsegment?.close();
    return { error_count: 0, failover_state: null, last_success_time: null };
  }
}

/**
 * Calculate TTL timestamp (30 days from now)
 * @returns Unix timestamp in seconds
 */
function calculateTTL(days: number = 30): number {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return Math.floor(now.getTime() / 1000);
}

/**
 * Reset error count
 * @param serviceName - Service name
 */
async function resetErrorCount(serviceName: string): Promise<void> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('resetErrorCount');
  subsegment?.addMetadata('serviceName', serviceName);

  const timestamp = new Date().toISOString();
  const ttl = calculateTTL(30); // 30 days TTL

  try {
    const { dynamodb: db } = getClients();
    await db.send(new UpdateCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: serviceName },
      UpdateExpression: 'SET error_count = :zero, last_success_time = :time, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#ttl': 'ttl'
      },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':time': timestamp,
        ':ttl': ttl
      }
    }));

    console.log(`Error count reset for ${serviceName}`);
    subsegment?.addAnnotation('resetSuccess', true);

    // Publish CloudWatch metric
    await publishMetric('ErrorCountReset', 1, [
      { Name: 'ServiceName', Value: serviceName }
    ]);
  } catch (error) {
    console.error('Failed to reset error count:', error);
    subsegment?.addError(error as Error);
  } finally {
    subsegment?.close();
  }
}

/**
 * Trigger cleanup workflow via Step Functions
 * @param serviceName - Service name
 * @param clusterArn - Cluster ARN
 */
async function triggerCleanup(serviceName: string, clusterArn: string | undefined): Promise<void> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('triggerCleanup');
  subsegment?.addMetadata('serviceName', serviceName);
  subsegment?.addMetadata('clusterArn', clusterArn);

  console.log(`Triggering cleanup for service: ${serviceName}`);

  try {
    const stateMachineArn = process.env.CLEANUP_STATE_MACHINE_ARN;
    if (!stateMachineArn) {
      throw new Error('CLEANUP_STATE_MACHINE_ARN environment variable is not set');
    }

    const clusterName = clusterArn ? clusterArn.split('/').pop() : CLUSTER_NAME;

    const { sfnClient } = getClients();
    await sfnClient.send(new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      input: JSON.stringify({
        clusterName: clusterName,
        spotServiceName: serviceName,
        standardServiceName: `${serviceName}-standard`,
        serviceName: serviceName,
        cleanupDelay: 30
      })
    }));
    console.log('Cleanup Step Functions started successfully');

    subsegment?.addAnnotation('stepFunctionStarted', true);
    subsegment?.addMetadata('stateMachineArn', stateMachineArn);

    // Publish CloudWatch metric
    await publishMetric('RecoveryTriggered', 1, [
      { Name: 'ServiceName', Value: serviceName }
    ]);

    // Send notification
    await sendNotification(
      'ECS Spot Recovery Initiated',
      `Service: ${serviceName}\nCluster: ${clusterArn}\nTime: ${new Date().toISOString()}\n\nSpot instances have recovered. Cleanup process initiated to switch back to Spot.`
    );

  } catch (error) {
    console.error('Failed to trigger cleanup:', error);
    subsegment?.addError(error as Error);
    
    // Publish failure metric
    await publishMetric('RecoveryTriggerFailed', 1, [
      { Name: 'ServiceName', Value: serviceName }
    ]);
    
    throw error;
  } finally {
    subsegment?.close();
  }
}

/**
 * Check if cleanup is already in progress
 * @param serviceName - Service name
 * @returns Whether cleanup is in progress
 */
async function isCleanupInProgress(serviceName: string): Promise<boolean> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('isCleanupInProgress');
  subsegment?.addMetadata('serviceName', serviceName);

  try {
    const result = await dynamodb.send(new GetCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: serviceName }
    }));

    const inProgress = result.Item && (result.Item.cleanup_in_progress as boolean);
    subsegment?.addMetadata('cleanupInProgress', inProgress);
    subsegment?.close();
    return !!inProgress;
  } catch (error) {
    console.error('Failed to check cleanup status:', error);
    subsegment?.addError(error as Error);
    subsegment?.close();
    return false;
  }
}

/**
 * Mark cleanup status
 * @param serviceName - Service name
 * @param inProgress - Whether cleanup is in progress
 */
async function markCleanupStatus(serviceName: string, inProgress: boolean): Promise<void> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('markCleanupStatus');
  subsegment?.addMetadata('serviceName', serviceName);
  subsegment?.addMetadata('inProgress', inProgress);

  try {
    const { dynamodb: db } = getClients();
    await db.send(new UpdateCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: serviceName },
      UpdateExpression: 'SET cleanup_in_progress = :status',
      ExpressionAttributeValues: {
        ':status': inProgress
      }
    }));
    subsegment?.addAnnotation('updateSuccess', true);
  } catch (error) {
    console.error('Failed to update cleanup status:', error);
    subsegment?.addError(error as Error);
  } finally {
    subsegment?.close();
  }
}

/**
 * Lambda handler function
 */
export const handler = async (event: LambdaEvent): Promise<LambdaResponse> => {
  // Get the current segment from X-Ray
  const segment = AWSXRay.getSegment();
  if (segment) {
    segment.addAnnotation('functionName', 'SpotSuccessMonitor');
    segment.addMetadata('eventSource', event.detail?.clusterArn);
  }

  console.log('Received event:', JSON.stringify(event, null, 2));

  const startTime = Date.now();

  try {
    // Validate event structure
    if (!event.detail) {
      console.log('No detail in event, skipping');
      return { statusCode: 200, body: 'No detail in event' };
    }

    const { detail } = event;
    const { clusterArn, taskArn, group, lastStatus } = detail;

    // Only process RUNNING status tasks
    if (lastStatus !== 'RUNNING') {
      console.log(`Task status is ${lastStatus}, not RUNNING, skipping`);
      return { statusCode: 200, body: 'Task not running' };
    }

    // Extract service name
    const serviceName = extractServiceName(group);
    console.log(`Service name: ${serviceName}`);

    // Add metadata to X-Ray segment
    segment?.addAnnotation('serviceName', serviceName);

    // Get current service state
    const serviceState = await getServiceState(serviceName);
    console.log(`Service state:`, JSON.stringify(serviceState));

    // Reset error count (task started successfully)
    if (serviceState.error_count > 0) {
      console.log(`Resetting error count for ${serviceName}`);
      await resetErrorCount(serviceName);
    }

    // Check if Spot task
    const isSpot = isSpotTask(detail);
    console.log(`Is Spot task: ${isSpot}`);

    // If not Spot task, skip
    if (!isSpot) {
      console.log('Not a Spot task, skipping');
      return { statusCode: 200, body: 'Not a Spot task' };
    }

    console.log(`Spot task successfully started: ${taskArn}`);
    
    // Publish CloudWatch metric
    await publishMetric('SpotTaskStarted', 1, [
      { Name: 'ServiceName', Value: serviceName }
    ]);

    // Check if there's an active failover state
    if (serviceState.failover_state && serviceState.failover_state.failover_active) {
      console.log('Active failover state detected, checking if cleanup should be triggered');

      // Check if cleanup is already in progress
      const cleanupInProgress = await isCleanupInProgress(serviceName);
      if (cleanupInProgress) {
        console.log('Cleanup already in progress, skipping');
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'Cleanup already in progress',
            serviceName
          })
        };
      }

      // Check if there have been enough successful tasks since failover
      // Simple approach: trigger recovery as long as Spot task starts successfully
      console.log('Triggering cleanup process');

      // Mark cleanup in progress
      await markCleanupStatus(serviceName, true);

      // Trigger cleanup orchestrator
      await triggerCleanup(serviceName, clusterArn);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Cleanup triggered successfully',
          serviceName,
          taskArn,
          failoverActive: true
        })
      };
    } else {
      console.log('No active failover state, normal operation');
    }

    // Publish latency metric
    const latency = Date.now() - startTime;
    await publishMetric('ProcessingLatency', latency, [
      { Name: 'ServiceName', Value: serviceName },
      { Name: 'Function', Value: 'SpotSuccessMonitor' }
    ]);

    segment?.addMetadata('processingLatency', latency);
    segment?.addAnnotation('success', true);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Spot success processed successfully',
        serviceName,
        errorCountReset: serviceState.error_count > 0,
        failoverActive: serviceState.failover_state ? serviceState.failover_state.failover_active : false
      })
    };

  } catch (error) {
    console.error('Error processing event:', error);

    // Publish error metric
    await publishMetric('FunctionError', 1, [
      { Name: 'Function', Value: 'SpotSuccessMonitor' }
    ]);

    // Add error to X-Ray segment
    segment?.addError(error as Error);
    segment?.addAnnotation('success', false);

    // Send error notification
    await sendNotification(
      'ECS Spot Failover System Error',
      `Lambda Function: SpotSuccessMonitor\nError: ${(error as Error).message}\nTime: ${new Date().toISOString()}`
    );

    throw error;
  }
};
