/**
 * Pending Task Monitor Lambda Function
 * 
 * Purpose: Periodically scan for ECS tasks stuck in PENDING state for too long,
 * which indicates Spot capacity issues. When tasks are stuck in PENDING,
 * this counts as an error toward the failover threshold.
 * 
 * Trigger: EventBridge Scheduled Rule (default: every 1 minute)
 * 
 * Background: This addresses a critical gap in pure event-driven monitoring.
 * When Spot capacity is exhausted, tasks may remain in PENDING state
 * indefinitely without generating STOPPED events. This Lambda detects
 * such situations and triggers failover proactively.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ECSClient, ListTasksCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import * as AWSXRay from 'aws-xray-sdk-core';

// Enable X-Ray tracing for AWS SDK v3 clients
const dynamodbClient = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const ecsClient = AWSXRay.captureAWSv3Client(new ECSClient({}));
const snsClient = AWSXRay.captureAWSv3Client(new SNSClient({}));
const sfnClient = AWSXRay.captureAWSv3Client(new SFNClient({}));
const cloudWatchClient = AWSXRay.captureAWSv3Client(new CloudWatchClient({}));

// Environment variables
const ERROR_COUNTER_TABLE = process.env.ERROR_COUNTER_TABLE || '';
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;
const CLUSTER_NAME = process.env.CLUSTER_NAME || '';
const SPOT_SERVICE_NAME = process.env.SPOT_SERVICE_NAME || '';
const FAILURE_THRESHOLD = parseInt(process.env.FAILURE_THRESHOLD || '3');
const PENDING_TASK_TIMEOUT_MINUTES = parseInt(process.env.PENDING_TASK_TIMEOUT_MINUTES || '5');
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

interface PendingTaskInfo {
  taskArn: string;
  pendingSince: Date;
  pendingMinutes: number;
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
 * Calculate TTL timestamp
 * @returns Unix timestamp in seconds
 */
function calculateTTL(days: number = 30): number {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return Math.floor(now.getTime() / 1000);
}

/**
 * List tasks in PENDING state for the Spot service
 * @returns Array of pending task ARNs
 */
async function listPendingTasks(): Promise<string[]> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('listPendingTasks');
  
  try {
    // List tasks in PENDING state
    const listResponse = await ecsClient.send(new ListTasksCommand({
      cluster: CLUSTER_NAME,
      serviceName: SPOT_SERVICE_NAME,
      desiredStatus: 'PENDING',
    }));

    const taskArns = listResponse.taskArns || [];
    console.log(`Found ${taskArns.length} tasks in PENDING state`);
    subsegment?.addMetadata('pendingTaskCount', taskArns.length);
    subsegment?.close();
    return taskArns;
  } catch (error) {
    console.error('Failed to list pending tasks:', error);
    subsegment?.addError(error as Error);
    subsegment?.close();
    return [];
  }
}

/**
 * Describe tasks to get detailed information including pending time
 * @param taskArns - Array of task ARNs
 * @returns Array of pending task info
 */
async function describePendingTasks(taskArns: string[]): Promise<PendingTaskInfo[]> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('describePendingTasks');
  
  try {
    const describeResponse = await ecsClient.send(new DescribeTasksCommand({
      cluster: CLUSTER_NAME,
      tasks: taskArns,
      include: ['TAGS'],
    }));

    const now = new Date();
    const pendingTasks: PendingTaskInfo[] = [];

    for (const task of describeResponse.tasks || []) {
      // Get the task creation time (when it entered PENDING)
      const createdAt = task.createdAt;
      if (!createdAt) continue;

      const pendingMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);
      
      // Only include tasks that have been pending longer than the threshold
      if (pendingMinutes >= PENDING_TASK_TIMEOUT_MINUTES) {
        pendingTasks.push({
          taskArn: task.taskArn || '',
          pendingSince: createdAt,
          pendingMinutes: Math.round(pendingMinutes),
        });
        
        console.log(`Task ${task.taskArn} has been pending for ${Math.round(pendingMinutes)} minutes`);
      }
    }

    subsegment?.addMetadata('longPendingTaskCount', pendingTasks.length);
    subsegment?.close();
    return pendingTasks;
  } catch (error) {
    console.error('Failed to describe pending tasks:', error);
    subsegment?.addError(error as Error);
    subsegment?.close();
    return [];
  }
}

/**
 * Update error count in DynamoDB
 * @param pendingTaskCount - Number of tasks stuck in PENDING
 * @returns Updated error count
 */
async function updateErrorCount(pendingTaskCount: number): Promise<number> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('updateErrorCount');
  subsegment?.addMetadata('serviceName', SPOT_SERVICE_NAME);
  subsegment?.addMetadata('pendingTaskCount', pendingTaskCount);

  const timestamp = new Date().toISOString();
  const ttl = calculateTTL(30);

  try {
    // Increment error count by the number of stuck tasks
    const result = await dynamodb.send(new UpdateCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: SPOT_SERVICE_NAME },
      UpdateExpression: 'SET error_count = if_not_exists(error_count, :zero) + :inc, last_error_time = :time, last_error_type = :errorType, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#ttl': 'ttl'
      },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': pendingTaskCount,
        ':time': timestamp,
        ':errorType': 'PENDING_TIMEOUT',
        ':ttl': ttl
      },
      ReturnValues: 'ALL_NEW'
    }));
    
    const errorCount = result.Attributes?.error_count as number;
    console.log(`Updated error count for ${SPOT_SERVICE_NAME}: ${errorCount}`);
    
    subsegment?.addMetadata('errorCount', errorCount);
    subsegment?.addAnnotation('updateSuccess', true);

    // Publish CloudWatch metric
    await publishMetric('PendingTaskErrorCount', pendingTaskCount, [
      { Name: 'ServiceName', Value: SPOT_SERVICE_NAME }
    ]);
    
    await publishMetric('SpotErrorCount', errorCount, [
      { Name: 'ServiceName', Value: SPOT_SERVICE_NAME }
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
 * @returns Current error count
 */
async function getErrorCount(): Promise<number> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('getErrorCount');
  
  try {
    const result = await dynamodb.send(new GetCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: SPOT_SERVICE_NAME }
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
 * Check if failover is already active
 * @returns Whether failover is active
 */
async function isFailoverActive(): Promise<boolean> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('isFailoverActive');
  
  try {
    const result = await dynamodb.send(new GetCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: SPOT_SERVICE_NAME }
    }));

    const failoverState = result.Item?.failover_state as FailoverState;
    const isActive = failoverState?.failover_active === true;
    
    subsegment?.addMetadata('failoverActive', isActive);
    subsegment?.close();
    return isActive;
  } catch (error) {
    console.error('Failed to check failover state:', error);
    subsegment?.addError(error as Error);
    subsegment?.close();
    return false;
  }
}

/**
 * Trigger failover process via Step Functions
 */
async function triggerFailover(stuckTaskCount: number): Promise<void> {
  const subsegment = AWSXRay.getSegment()?.addNewSubsegment('triggerFailover');
  
  console.log(`Triggering failover for service: ${SPOT_SERVICE_NAME}`);

  try {
    const stateMachineArn = process.env.FAILOVER_STATE_MACHINE_ARN;
    if (!stateMachineArn) {
      throw new Error('FAILOVER_STATE_MACHINE_ARN environment variable is not set');
    }

    await sfnClient.send(new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      input: JSON.stringify({
        clusterName: CLUSTER_NAME,
        spotServiceName: SPOT_SERVICE_NAME,
        standardServiceName: `${SPOT_SERVICE_NAME}-standard`,
        serviceName: SPOT_SERVICE_NAME,
        triggerReason: 'PENDING_TASK_TIMEOUT',
        stuckTaskCount: stuckTaskCount,
      })
    }));
    
    console.log('Failover Step Functions started successfully');
    subsegment?.addAnnotation('stepFunctionStarted', true);

    // Publish CloudWatch metric
    await publishMetric('FailoverTriggered', 1, [
      { Name: 'ServiceName', Value: SPOT_SERVICE_NAME },
      { Name: 'TriggerReason', Value: 'PENDING_TASK_TIMEOUT' }
    ]);

    // Send notification
    await sendNotification(
      'ECS Spot Failover Triggered (PENDING Task Timeout)',
      `Service: ${SPOT_SERVICE_NAME}\nCluster: ${CLUSTER_NAME}\n` +
      `Error Count: ${FAILURE_THRESHOLD}\n` +
      `Trigger Reason: Tasks stuck in PENDING for > ${PENDING_TASK_TIMEOUT_MINUTES} minutes\n` +
      `Stuck Tasks: ${stuckTaskCount}\n` +
      `Time: ${new Date().toISOString()}\n\n` +
      `Failover has been initiated to switch from Spot to Standard Fargate instances.`
    );

  } catch (error) {
    console.error('Failed to trigger failover:', error);
    subsegment?.addError(error as Error);
    
    await publishMetric('FailoverTriggerFailed', 1, [
      { Name: 'ServiceName', Value: SPOT_SERVICE_NAME }
    ]);
    
    throw error;
  } finally {
    subsegment?.close();
  }
}

/**
 * Lambda handler function
 */
export const handler = async (): Promise<LambdaResponse> => {
  const segment = AWSXRay.getSegment();
  if (segment) {
    segment.addAnnotation('functionName', 'PendingTaskMonitor');
    segment.addAnnotation('clusterName', CLUSTER_NAME);
    segment.addAnnotation('serviceName', SPOT_SERVICE_NAME);
  }

  console.log('Starting PENDING task monitoring scan');
  console.log(`Configuration: timeout=${PENDING_TASK_TIMEOUT_MINUTES}min, threshold=${FAILURE_THRESHOLD}`);

  const startTime = Date.now();

  try {
    // Check if failover is already active
    const failoverActive = await isFailoverActive();
    if (failoverActive) {
      console.log('Failover already active, skipping PENDING task check');
      return { 
        statusCode: 200, 
        body: JSON.stringify({ message: 'Failover already active, skipping' }) 
      };
    }

    // List tasks in PENDING state
    const pendingTaskArns = await listPendingTasks();
    
    if (pendingTaskArns.length === 0) {
      console.log('No PENDING tasks found');
      return { 
        statusCode: 200, 
        body: JSON.stringify({ message: 'No pending tasks', stuckTasks: 0 }) 
      };
    }

    // Get details of pending tasks and filter for timeout
    const stuckTasks = await describePendingTasks(pendingTaskArns);
    
    if (stuckTasks.length === 0) {
      console.log(`All ${pendingTaskArns.length} PENDING tasks are within timeout threshold`);
      return { 
        statusCode: 200, 
        body: JSON.stringify({ 
          message: 'No stuck tasks', 
          pendingTasks: pendingTaskArns.length,
          stuckTasks: 0 
        }) 
      };
    }

    console.log(`Found ${stuckTasks.length} tasks stuck in PENDING for > ${PENDING_TASK_TIMEOUT_MINUTES} minutes`);

    // Update error count
    const errorCount = await updateErrorCount(stuckTasks.length);

    // Publish metric for stuck tasks
    await publishMetric('StuckPendingTasks', stuckTasks.length, [
      { Name: 'ServiceName', Value: SPOT_SERVICE_NAME }
    ]);

    // Send warning notification if tasks are stuck but threshold not reached
    if (errorCount < FAILURE_THRESHOLD) {
      await sendNotification(
        'ECS Spot Warning: Tasks Stuck in PENDING',
        `Service: ${SPOT_SERVICE_NAME}\nCluster: ${CLUSTER_NAME}\n` +
        `Stuck Tasks: ${stuckTasks.length}\n` +
        `Error Count: ${errorCount}/${FAILURE_THRESHOLD}\n` +
        `Time: ${new Date().toISOString()}\n\n` +
        `Tasks have been stuck in PENDING for > ${PENDING_TASK_TIMEOUT_MINUTES} minutes. ` +
        `This indicates Spot capacity issues. Failover will trigger at ${FAILURE_THRESHOLD} errors.`
      );
    }

    // Check if failover threshold is reached
    if (errorCount >= FAILURE_THRESHOLD) {
      console.log(`Error count (${errorCount}) reached threshold (${FAILURE_THRESHOLD}), triggering failover`);
      await triggerFailover(stuckTasks.length);
    } else {
      console.log(`Error count (${errorCount}) below threshold (${FAILURE_THRESHOLD})`);
    }

    // Publish latency metric
    const latency = Date.now() - startTime;
    await publishMetric('ProcessingLatency', latency, [
      { Name: 'ServiceName', Value: SPOT_SERVICE_NAME },
      { Name: 'Function', Value: 'PendingTaskMonitor' }
    ]);

    segment?.addMetadata('processingLatency', latency);
    segment?.addMetadata('stuckTasks', stuckTasks.length);
    segment?.addAnnotation('success', true);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'PENDING task monitoring completed',
        pendingTasks: pendingTaskArns.length,
        stuckTasks: stuckTasks.length,
        errorCount,
        threshold: FAILURE_THRESHOLD,
        failoverTriggered: errorCount >= FAILURE_THRESHOLD
      })
    };

  } catch (error) {
    console.error('Error processing PENDING task scan:', error);

    // Publish error metric
    await publishMetric('FunctionError', 1, [
      { Name: 'Function', Value: 'PendingTaskMonitor' }
    ]);

    // Add error to X-Ray segment
    segment?.addError(error as Error);
    segment?.addAnnotation('success', false);

    // Send error notification
    await sendNotification(
      'ECS Spot Failover System Error',
      `Lambda Function: PendingTaskMonitor\nError: ${(error as Error).message}\nTime: ${new Date().toISOString()}`
    );

    throw error;
  }
};
