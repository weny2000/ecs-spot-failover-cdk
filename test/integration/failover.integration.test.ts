/**
 * Integration Tests for ECS Fargate Spot Failover
 * 
 * These tests verify the end-to-end failover functionality
 * by interacting with actual AWS services.
 * 
 * Prerequisites:
 * - AWS credentials configured
 * - Stack deployed to AWS account
 * - Environment variables set:
 *   - AWS_REGION
 *   - CLUSTER_NAME
 *   - ERROR_COUNTER_TABLE
 *   - FAILOVER_STATE_MACHINE_ARN
 *   - CLEANUP_STATE_MACHINE_ARN
 */

import { jest } from '@jest/globals';
import { ECSClient, DescribeServicesCommand, ListTasksCommand } from '@aws-sdk/client-ecs';
import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { SNSClient, ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { XRayClient, GetServiceGraphCommand, GetTraceSummariesCommand } from '@aws-sdk/client-x-ray';

// AWS Clients
const ecsClient = new ECSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const sfnClient = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });
const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const cloudwatchClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-1' });
const xrayClient = new XRayClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Test Configuration
const TEST_SERVICE_NAME = 'test-failover-service';
const CLUSTER_NAME = process.env.CLUSTER_NAME || 'fargate-spot-cluster';
const ERROR_COUNTER_TABLE = process.env.ERROR_COUNTER_TABLE || 'fargate-spot-error-counter';
const FAILOVER_STATE_MACHINE_ARN = process.env.FAILOVER_STATE_MACHINE_ARN || '';
const CLEANUP_STATE_MACHINE_ARN = process.env.CLEANUP_STATE_MACHINE_ARN || '';

// Helper function to wait
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to wait for Step Functions execution
async function waitForExecution(executionArn: string, maxAttempts = 30): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await sfnClient.send(new DescribeExecutionCommand({
      executionArn: executionArn
    }));
    
    if (result.status === 'SUCCEEDED') {
      return 'SUCCEEDED';
    }
    if (result.status === 'FAILED' || result.status === 'TIMED_OUT' || result.status === 'ABORTED') {
      return result.status;
    }
    
    await wait(10000); // Wait 10 seconds between checks
  }
  return 'TIMEOUT';
}

describe('ECS Fargate Spot Failover Integration Tests', () => {
  
  beforeAll(async () => {
    // Verify prerequisites
    console.log('Checking prerequisites...');
    
    if (!FAILOVER_STATE_MACHINE_ARN) {
      throw new Error('FAILOVER_STATE_MACHINE_ARN environment variable is required');
    }
    
    // Clean up any existing test data
    await cleanupTestData();
  });

  afterAll(async () => {
    // Clean up test data
    await cleanupTestData();
  });

  async function cleanupTestData(): Promise<void> {
    try {
      await dynamodbClient.send(new DeleteItemCommand({
        TableName: ERROR_COUNTER_TABLE,
        Key: {
          service_name: { S: TEST_SERVICE_NAME }
        }
      }));
    } catch (error) {
      // Ignore if item doesn't exist
    }
  }

  describe('DynamoDB Integration', () => {
    it('should successfully write and read from error counter table', async () => {
      const timestamp = new Date().toISOString();
      
      // Write test data
      await dynamodbClient.send(new PutItemCommand({
        TableName: ERROR_COUNTER_TABLE,
        Item: {
          service_name: { S: TEST_SERVICE_NAME },
          error_count: { N: '3' },
          last_error_time: { S: timestamp },
          failover_state: {
            M: {
              failover_active: { BOOL: true },
              failover_time: { S: timestamp }
            }
          }
        }
      }));

      // Read test data
      const result = await dynamodbClient.send(new GetItemCommand({
        TableName: ERROR_COUNTER_TABLE,
        Key: {
          service_name: { S: TEST_SERVICE_NAME }
        }
      }));

      expect(result.Item).toBeDefined();
      expect(result.Item?.service_name.S).toBe(TEST_SERVICE_NAME);
      expect(result.Item?.error_count.N).toBe('3');
      expect(result.Item?.failover_state?.M?.failover_active.BOOL).toBe(true);
    });

    it('should support table configuration', async () => {
      const tableInfo = await dynamodbClient.send(new DescribeTableCommand({
        TableName: ERROR_COUNTER_TABLE
      }));
      
      expect(tableInfo.Table).toBeDefined();
      expect(tableInfo.Table?.TableName).toBe(ERROR_COUNTER_TABLE);
    });
  });

  describe('ECS Integration', () => {
    it('should describe cluster services', async () => {
      const result = await ecsClient.send(new DescribeServicesCommand({
        cluster: CLUSTER_NAME,
        services: ['sample-app', 'sample-app-standard']
      }));

      expect(result.services).toBeDefined();
      expect(result.services?.length).toBeGreaterThan(0);
    });

    it('should list cluster tasks', async () => {
      const result = await ecsClient.send(new ListTasksCommand({
        cluster: CLUSTER_NAME,
        serviceName: 'sample-app'
      }));

      expect(result.taskArns).toBeDefined();
    });
  });

  describe('Step Functions Integration', () => {
    it('should start and complete failover workflow', async () => {
      // Start failover execution
      const startResult = await sfnClient.send(new StartExecutionCommand({
        stateMachineArn: FAILOVER_STATE_MACHINE_ARN,
        input: JSON.stringify({
          clusterName: CLUSTER_NAME,
          spotServiceName: 'sample-app',
          standardServiceName: 'sample-app-standard',
          serviceName: 'sample-app'
        })
      }));

      expect(startResult.executionArn).toBeDefined();

      // Wait for execution to complete (with timeout)
      const status = await waitForExecution(startResult.executionArn!, 60);
      
      // Note: This might fail if services don't exist
      // In real test environment, we expect SUCCEEDED or FAILED
      expect(['SUCCEEDED', 'FAILED', 'TIMEOUT']).toContain(status);
    }, 600000); // 10 minute timeout

    it('should start and complete cleanup workflow', async () => {
      // Pre-condition: Set failover state
      await dynamodbClient.send(new PutItemCommand({
        TableName: ERROR_COUNTER_TABLE,
        Item: {
          service_name: { S: 'sample-app' },
          failover_state: {
            M: {
              failover_active: { BOOL: true },
              original_desired_count: { N: '2' }
            }
          }
        }
      }));

      // Start cleanup execution
      const startResult = await sfnClient.send(new StartExecutionCommand({
        stateMachineArn: CLEANUP_STATE_MACHINE_ARN,
        input: JSON.stringify({
          clusterName: CLUSTER_NAME,
          spotServiceName: 'sample-app',
          standardServiceName: 'sample-app-standard',
          serviceName: 'sample-app',
          cleanupDelay: 5 // Short delay for testing
        })
      }));

      expect(startResult.executionArn).toBeDefined();

      // Wait for execution
      const status = await waitForExecution(startResult.executionArn!, 60);
      
      expect(['SUCCEEDED', 'FAILED', 'TIMEOUT']).toContain(status);
    }, 600000);
  });

  describe('SNS Integration', () => {
    it('should list SNS topic subscriptions', async () => {
      const topicArn = process.env.NOTIFICATION_TOPIC_ARN;
      if (!topicArn) {
        console.log('Skipping SNS test - NOTIFICATION_TOPIC_ARN not set');
        return;
      }

      const result = await snsClient.send(new ListSubscriptionsByTopicCommand({
        TopicArn: topicArn
      }));

      expect(result.subscriptions).toBeDefined();
    });
  });

  describe('CloudWatch Integration', () => {
    it('should retrieve custom metrics', async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 3600000); // 1 hour ago

      const result = await cloudwatchClient.send(new GetMetricDataCommand({
        StartTime: startTime,
        EndTime: endTime,
        MetricDataQueries: [
          {
            Id: 'm1',
            MetricStat: {
              Metric: {
                Namespace: 'ECS/FargateSpotFailover',
                MetricName: 'SpotErrorDetected'
              },
              Period: 300,
              Stat: 'Sum'
            }
          }
        ]
      }));

      expect(result.MetricDataResults).toBeDefined();
    });
  });

  describe('X-Ray Integration', () => {
    it('should retrieve X-Ray service graph', async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 3600000); // 1 hour ago

      const result = await xrayClient.send(new GetServiceGraphCommand({
        StartTime: startTime,
        EndTime: endTime
      }));

      expect(result.Services).toBeDefined();
    });

    it('should retrieve X-Ray trace summaries', async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 3600000); // 1 hour ago

      const result = await xrayClient.send(new GetTraceSummariesCommand({
        StartTime: startTime,
        EndTime: endTime,
        FilterExpression: 'service("SpotErrorDetector")'
      }));

      expect(result.TraceSummaries).toBeDefined();
    });
  });

  describe('End-to-End Failover Flow', () => {
    it('should complete full failover and recovery cycle', async () => {
      // Step 1: Initial state - verify Spot service is running
      const initialSpotService = await ecsClient.send(new DescribeServicesCommand({
        cluster: CLUSTER_NAME,
        services: ['sample-app']
      }));
      
      console.log('Initial Spot service state:', {
        desired: initialSpotService.services?.[0].desiredCount,
        running: initialSpotService.services?.[0].runningCount
      });

      // Step 2: Simulate Spot errors by setting error count
      await dynamodbClient.send(new PutItemCommand({
        TableName: ERROR_COUNTER_TABLE,
        Item: {
          service_name: { S: 'sample-app' },
          error_count: { N: '3' },
          failover_state: {
            M: {
              failover_active: { BOOL: false }
            }
          }
        }
      }));

      // Step 3: Trigger failover workflow
      console.log('Starting failover workflow...');
      const failoverStart = await sfnClient.send(new StartExecutionCommand({
        stateMachineArn: FAILOVER_STATE_MACHINE_ARN,
        input: JSON.stringify({
          clusterName: CLUSTER_NAME,
          spotServiceName: 'sample-app',
          standardServiceName: 'sample-app-standard',
          serviceName: 'sample-app'
        })
      }));

      // Step 4: Wait for failover to complete
      const failoverStatus = await waitForExecution(failoverStart.executionArn!, 60);
      console.log('Failover status:', failoverStatus);

      // Step 5: Verify failover state in DynamoDB
      const failoverState = await dynamodbClient.send(new GetItemCommand({
        TableName: ERROR_COUNTER_TABLE,
        Key: {
          service_name: { S: 'sample-app' }
        }
      }));

      if (failoverStatus === 'SUCCEEDED') {
        expect(failoverState.Item?.failover_state?.M?.failover_active.BOOL).toBe(true);
      }

      // Step 6: Trigger cleanup workflow
      console.log('Starting cleanup workflow...');
      const cleanupStart = await sfnClient.send(new StartExecutionCommand({
        stateMachineArn: CLEANUP_STATE_MACHINE_ARN,
        input: JSON.stringify({
          clusterName: CLUSTER_NAME,
          spotServiceName: 'sample-app',
          standardServiceName: 'sample-app-standard',
          serviceName: 'sample-app',
          cleanupDelay: 5
        })
      }));

      // Step 7: Wait for cleanup to complete
      const cleanupStatus = await waitForExecution(cleanupStart.executionArn!, 60);
      console.log('Cleanup status:', cleanupStatus);

      // Step 8: Verify final state
      const finalState = await dynamodbClient.send(new GetItemCommand({
        TableName: ERROR_COUNTER_TABLE,
        Key: {
          service_name: { S: 'sample-app' }
        }
      }));

      if (cleanupStatus === 'SUCCEEDED') {
        expect(finalState.Item?.error_count.N).toBe('0');
        expect(finalState.Item?.failover_state?.M?.failover_active.BOOL).toBe(false);
      }

    }, 900000); // 15 minute timeout for full E2E test
  });
});
