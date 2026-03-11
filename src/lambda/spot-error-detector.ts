/**
 * Spot Error Detector Lambda Function
 * 
 * Purpose: Monitor ECS task stopped events, identify Spot-related errors,
 * maintain error counters, and trigger failover when threshold is reached.
 * Trigger: EventBridge - ECS Task State Change (STOPPED)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import * as AWSXRay from 'aws-xray-sdk-core';

// Enable X-Ray tracing for AWS SDK v3 clients
const dynamodbClient = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const snsClient = AWSXRay.captureAWSv3Client(new SNSClient({}));
const sfnClient = AWSXRay.captureAWSv3Client(new SFNClient({}));
const cloudWatchClient = AWSXRay.captureAWSv3Client(new CloudWatchClient({}));

// Environment variables
const ERROR_COUNTER_TABLE = process.env.ERROR_COUNTER_TABLE || '';
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;
const FAILURE_THRESHOLD = parseInt(process.env.FAILURE_THRESHOLD || '3');
const NAMESPACE = process.env.CLOUDWATCH_NAMESPACE || 'ECS/FargateSpotFailover';

// Type definitions
interface FailoverState {
  failover_active: boolean;
  failover_time: string;
  spot_service: string;
  standard_service: string;
  original_desired_count: number;
  cluster_arn: string;
}

interface EventDetail {
  clusterArn?: string;
  taskArn?: string;
  stoppedReason?: string;
  group?: string;
  lastStatus?: string;
}

interface LambdaEvent {
  detail?: EventDetail;
}

interface LambdaResponse {
  statusCode: number;
  body: string;
}

/**
 * Check if the stopped reason is Spot-related error
 * @param stoppedReason - The task stopped reason
 * @returns Whether it's a Spot error
 */
function isSpotError(stoppedReason: string | undefined): boolean {
  if (!stoppedReason) return false;

  const spotErrorPatterns = [
    /SpotInterruption/i,
    /ResourcesNotAvailable/i,
    /Task stopped due to/i,
    /spot instance/i,
    /capacity.*not.*available/i,
    /insufficient.*capacity/i
  ];

  return spotErrorPatterns.some(pattern => pattern.test(stoppedReason));
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
 * Send SNS notification
 * @param subject - Notification subject
 * @param message - Notification message
 */
async function sendNotification(subject: string, message: string): Promise<void> {
  if (!NOTIFICATION_TOPIC_ARN) return;

  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('sendNotification');
  try {
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
 * Calculate TTL timestamp (30 days from now)
 * @returns Unix timestamp in seconds
 */
function calculateTTL(days: number = 30): number {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return Math.floor(now.getTime() / 1000);
}

/**
 * Update error count in DynamoDB
 * @param serviceName - Service name
 * @returns Updated error count
 */
async function updateErrorCount(serviceName: string): Promise<number> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('updateErrorCount');
  subsegment?.addMetadata('serviceName', serviceName);

  const timestamp = new Date().toISOString();
  const ttl = calculateTTL(30); // 30 days TTL

  try {
    const result = await dynamodb.send(new UpdateCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: serviceName },
      UpdateExpression: 'SET error_count = if_not_exists(error_count, :zero) + :inc, last_error_time = :time, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#ttl': 'ttl'
      },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
        ':time': timestamp,
        ':ttl': ttl
      },
      ReturnValues: 'ALL_NEW'
    }));
    const errorCount = result.Attributes?.error_count as number;
    console.log(`Updated error count for ${serviceName}: ${errorCount}`);
    
    subsegment?.addMetadata('errorCount', errorCount);
    subsegment?.addAnnotation('updateSuccess', true);

    // Publish CloudWatch metric
    await publishMetric('SpotErrorCount', errorCount, [
      { Name: 'ServiceName', Value: serviceName }
    ]);
    
    return errorCount;
  } catch (error) {
    console.error('Failed to update error count:', error);
    subsegment?.addError(error as Error);
    throw error;
  } finally {
    subsegment?.close();
  }
}

/**
 * Get current error count
 * @param serviceName - Service name
 * @returns Current error count
 */
async function getErrorCount(serviceName: string): Promise<number> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('getErrorCount');
  subsegment?.addMetadata('serviceName', serviceName);

  try {
    const result = await dynamodb.send(new GetCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: serviceName }
    }));
    const count = result.Item ? (result.Item.error_count as number) || 0 : 0;
    subsegment?.addMetadata('errorCount', count);
    subsegment?.close();
    return count;
  } catch (error) {
    console.error('Failed to get error count:', error);
    subsegment?.addError(error as Error);
    subsegment?.close();
    return 0;
  }
}

/**
 * Trigger failover process via Step Functions
 * @param serviceName - Service name
 * @param clusterArn - Cluster ARN
 */
async function triggerFailover(serviceName: string, clusterArn: string | undefined): Promise<void> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('triggerFailover');
  subsegment?.addMetadata('serviceName', serviceName);
  subsegment?.addMetadata('clusterArn', clusterArn);

  console.log(`Triggering failover for service: ${serviceName}`);

  try {
    const stateMachineArn = process.env.FAILOVER_STATE_MACHINE_ARN;
    if (!stateMachineArn) {
      throw new Error('FAILOVER_STATE_MACHINE_ARN environment variable is not set');
    }

    const clusterName = clusterArn ? clusterArn.split('/').pop() : process.env.CLUSTER_NAME;

    await sfnClient.send(new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      input: JSON.stringify({
        clusterName: clusterName,
        spotServiceName: serviceName,
        standardServiceName: `${serviceName}-standard`,
        serviceName: serviceName
      })
    }));
    console.log('Failover Step Functions started successfully');

    subsegment?.addAnnotation('stepFunctionStarted', true);
    subsegment?.addMetadata('stateMachineArn', stateMachineArn);

    // Publish CloudWatch metric
    await publishMetric('FailoverTriggered', 1, [
      { Name: 'ServiceName', Value: serviceName }
    ]);

    // Send notification
    await sendNotification(
      'ECS Spot Failover Triggered',
      `Service: ${serviceName}\nCluster: ${clusterArn}\nError Count: ${FAILURE_THRESHOLD}\nTime: ${new Date().toISOString()}\n\nFailover has been initiated to switch from Spot to Standard Fargate instances.`
    );

  } catch (error) {
    console.error('Failed to trigger failover:', error);
    subsegment?.addError(error as Error);
    
    // Publish failure metric
    await publishMetric('FailoverTriggerFailed', 1, [
      { Name: 'ServiceName', Value: serviceName }
    ]);
    
    throw error;
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
    segment.addAnnotation('functionName', 'SpotErrorDetector');
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
    const { clusterArn, taskArn, stoppedReason, group, lastStatus } = detail;

    // Only process STOPPED status tasks
    if (lastStatus !== 'STOPPED') {
      console.log(`Task status is ${lastStatus}, not STOPPED, skipping`);
      return { statusCode: 200, body: 'Task not stopped' };
    }

    // Check if it's a Spot-related error
    if (!isSpotError(stoppedReason)) {
      console.log(`Not a Spot error: ${stoppedReason}, skipping`);
      return { statusCode: 200, body: 'Not a Spot error' };
    }

    console.log(`Detected Spot instance error: ${stoppedReason}`);

    // Extract service name
    const serviceName = extractServiceName(group);
    console.log(`Service name: ${serviceName}`);

    // Add metadata to X-Ray segment
    segment?.addAnnotation('serviceName', serviceName);
    segment?.addAnnotation('stoppedReason', stoppedReason);

    // Update error count
    const errorCount = await updateErrorCount(serviceName);

    // Publish error detected metric
    await publishMetric('SpotErrorDetected', 1, [
      { Name: 'ServiceName', Value: serviceName },
      { Name: 'ErrorType', Value: stoppedReason || 'Unknown' }
    ]);

    // Send error notification
    await sendNotification(
      'ECS Spot Instance Error Detected',
      `Service: ${serviceName}\nTask: ${taskArn}\nReason: ${stoppedReason}\nError Count: ${errorCount}/${FAILURE_THRESHOLD}\nTime: ${new Date().toISOString()}`
    );

    // Check if failover threshold is reached
    if (errorCount >= FAILURE_THRESHOLD) {
      console.log(`Error count (${errorCount}) reached threshold (${FAILURE_THRESHOLD}), triggering failover`);

      // Check if already in failover state
      const existingState = await dynamodb.send(new GetCommand({
        TableName: ERROR_COUNTER_TABLE,
        Key: { service_name: serviceName }
      }));

      if (existingState.Item && (existingState.Item.failover_state as FailoverState)?.failover_active) {
        console.log('Failover already active, skipping');
        return { statusCode: 200, body: 'Failover already active' };
      }

      await triggerFailover(serviceName, clusterArn);
    } else {
      console.log(`Error count (${errorCount}) below threshold (${FAILURE_THRESHOLD})`);
    }

    // Publish latency metric
    const latency = Date.now() - startTime;
    await publishMetric('ProcessingLatency', latency, [
      { Name: 'ServiceName', Value: serviceName },
      { Name: 'Function', Value: 'SpotErrorDetector' }
    ]);

    segment?.addMetadata('processingLatency', latency);
    segment?.addAnnotation('success', true);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Spot error processed successfully',
        serviceName,
        errorCount,
        threshold: FAILURE_THRESHOLD
      })
    };

  } catch (error) {
    console.error('Error processing event:', error);

    // Publish error metric
    await publishMetric('FunctionError', 1, [
      { Name: 'Function', Value: 'SpotErrorDetector' }
    ]);

    // Add error to X-Ray segment
    segment?.addError(error as Error);
    segment?.addAnnotation('success', false);

    // Send error notification
    await sendNotification(
      'ECS Spot Failover System Error',
      `Lambda Function: SpotErrorDetector\nError: ${(error as Error).message}\nTime: ${new Date().toISOString()}`
    );

    throw error;
  }
};
