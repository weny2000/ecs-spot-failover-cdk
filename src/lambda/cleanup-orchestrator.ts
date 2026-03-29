/**
 * Cleanup Orchestrator Lambda Function
 * 
 * Purpose: Execute failback from Standard to Spot Fargate
 * Trigger: Step Functions or direct invocation
 */

import { ECSClient, UpdateServiceCommand, DescribeServicesCommand } from '@aws-sdk/client-ecs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const ecsClient = new ECSClient({});
const dynamodbClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const snsClient = new SNSClient({});

const ERROR_COUNTER_TABLE = process.env.ERROR_COUNTER_TABLE || '';
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;
const CLUSTER_NAME = process.env.CLUSTER_NAME || 'fargate-spot-cluster';

interface CleanupInput {
  clusterName: string;
  spotServiceName: string;
  standardServiceName: string;
  serviceName: string;
  cleanupDelay?: number;
}

export const handler = async (event: CleanupInput): Promise<any> => {
  console.log('Cleanup orchestrator triggered', JSON.stringify(event));
  
  const { clusterName, spotServiceName, standardServiceName, serviceName, cleanupDelay = 30 } = event;
  
  try {
    // Get current state
    const stateResult = await dynamodb.send(new GetCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: serviceName }
    }));
    
    const originalDesiredCount = stateResult.Item?.failover_state?.original_desired_count || 2;
    
    // Start spot service
    await ecsClient.send(new UpdateServiceCommand({
      cluster: clusterName,
      service: spotServiceName,
      desiredCount: originalDesiredCount
    }));
    
    // Wait for stabilization
    await new Promise(resolve => setTimeout(resolve, cleanupDelay * 1000));
    
    // Stop standard service
    await ecsClient.send(new UpdateServiceCommand({
      cluster: clusterName,
      service: standardServiceName,
      desiredCount: 0
    }));
    
    // Reset error count and failover state
    await dynamodb.send(new UpdateCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: serviceName },
      UpdateExpression: 'SET error_count = :zero, failover_state = :state, cleanup_in_progress = :false',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':state': {
          failover_active: false,
          recovery_time: new Date().toISOString()
        },
        ':false': false
      }
    }));
    
    // Send notification
    if (NOTIFICATION_TOPIC_ARN) {
      await snsClient.send(new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Subject: 'ECS Recovery Completed',
        Message: `Recovery completed for ${serviceName}. Traffic routed back to Spot.`
      }));
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Recovery completed', serviceName })
    };
  } catch (error) {
    console.error('Recovery failed:', error);
    throw error;
  }
};
