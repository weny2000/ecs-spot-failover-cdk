/**
 * Failback Orchestrator Lambda Function
 * 
 * Purpose: Execute failover from Spot to Standard Fargate
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

interface FailoverInput {
  clusterName: string;
  spotServiceName: string;
  standardServiceName: string;
  serviceName: string;
}

export const handler = async (event: FailoverInput): Promise<any> => {
  console.log('Failback orchestrator triggered', JSON.stringify(event));
  
  const { clusterName, spotServiceName, standardServiceName, serviceName } = event;
  
  try {
    // Get current state
    const stateResult = await dynamodb.send(new GetCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: serviceName }
    }));
    
    const originalDesiredCount = stateResult.Item?.failover_state?.original_desired_count || 2;
    
    // Update failover state
    await dynamodb.send(new UpdateCommand({
      TableName: ERROR_COUNTER_TABLE,
      Key: { service_name: serviceName },
      UpdateExpression: 'SET failover_state = :state',
      ExpressionAttributeValues: {
        ':state': {
          failover_active: true,
          failover_time: new Date().toISOString(),
          spot_service: spotServiceName,
          standard_service: standardServiceName,
          original_desired_count: originalDesiredCount
        }
      }
    }));
    
    // Start standard service
    await ecsClient.send(new UpdateServiceCommand({
      cluster: clusterName,
      service: standardServiceName,
      desiredCount: originalDesiredCount
    }));
    
    // Wait for stabilization (simplified)
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Stop spot service
    await ecsClient.send(new UpdateServiceCommand({
      cluster: clusterName,
      service: spotServiceName,
      desiredCount: 0
    }));
    
    // Send notification
    if (NOTIFICATION_TOPIC_ARN) {
      await snsClient.send(new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Subject: 'ECS Failover Completed',
        Message: `Failover completed for ${serviceName}. Traffic routed to standard Fargate.`
      }));
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Failover completed', serviceName })
    };
  } catch (error) {
    console.error('Failover failed:', error);
    throw error;
  }
};
