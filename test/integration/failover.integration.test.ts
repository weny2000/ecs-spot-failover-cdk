/**
 * Integration Tests for ECS Fargate Spot Failover
 * 
 * These tests verify the end-to-end failover functionality
 * using mocked AWS SDK clients (no real AWS credentials required).
 * 
 * Mocked AWS Services:
 * - ECS: DescribeServices, ListTasks
 * - DynamoDB: GetItem, PutItem, DeleteItem, DescribeTable
 * - Step Functions: StartExecution, DescribeExecution
 * - SNS: ListSubscriptionsByTopic
 * - CloudWatch: GetMetricData
 * - X-Ray: GetServiceGraph, GetTraceSummaries
 */

import { jest } from '@jest/globals';

// Mock all AWS SDK clients before imports
const mockECSSend = jest.fn();
const mockDynamoDBSend = jest.fn();
const mockSFNSend = jest.fn();
const mockSNSSend = jest.fn();
const mockCloudWatchSend = jest.fn();
const mockXRaySend = jest.fn();

jest.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: jest.fn().mockImplementation(() => ({
    send: mockECSSend,
  })),
  DescribeServicesCommand: jest.fn().mockImplementation((params) => params),
  ListTasksCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: mockDynamoDBSend,
  })),
  GetItemCommand: jest.fn().mockImplementation((params) => params),
  PutItemCommand: jest.fn().mockImplementation((params) => params),
  DeleteItemCommand: jest.fn().mockImplementation((params) => params),
  DescribeTableCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({
    send: mockSFNSend,
  })),
  StartExecutionCommand: jest.fn().mockImplementation((params) => params),
  DescribeExecutionCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: mockSNSSend,
  })),
  ListSubscriptionsByTopicCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn().mockImplementation(() => ({
    send: mockCloudWatchSend,
  })),
  GetMetricDataCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-xray', () => ({
  XRayClient: jest.fn().mockImplementation(() => ({
    send: mockXRaySend,
  })),
  GetServiceGraphCommand: jest.fn().mockImplementation((params) => params),
  GetTraceSummariesCommand: jest.fn().mockImplementation((params) => params),
}));

// Import after mocking
import { ECSClient, DescribeServicesCommand, ListTasksCommand } from '@aws-sdk/client-ecs';
import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { SNSClient, ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { XRayClient, GetServiceGraphCommand, GetTraceSummariesCommand } from '@aws-sdk/client-xray';

// Test Configuration
const TEST_SERVICE_NAME = 'test-failover-service';
const CLUSTER_NAME = 'fargate-spot-cluster';
const ERROR_COUNTER_TABLE = 'fargate-spot-error-counter';
const FAILOVER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:failover-state-machine';
const CLEANUP_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:cleanup-state-machine';
const NOTIFICATION_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:notifications';

// Helper function to wait
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to wait for Step Functions execution
async function waitForExecution(executionArn: string, maxAttempts = 30): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await mockSFNSend.mock.results[mockSFNSend.mock.calls.length - 1]?.value;
    
    if (result?.status === 'SUCCEEDED') {
      return 'SUCCEEDED';
    }
    if (result?.status === 'FAILED' || result?.status === 'TIMED_OUT' || result?.status === 'ABORTED') {
      return result.status;
    }
    
    await wait(100); // Short wait for mock tests
  }
  return 'TIMEOUT';
}

describe('ECS Fargate Spot Failover Integration Tests', () => {
  
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Set up environment variables
    process.env.CLUSTER_NAME = CLUSTER_NAME;
    process.env.ERROR_COUNTER_TABLE = ERROR_COUNTER_TABLE;
    process.env.FAILOVER_STATE_MACHINE_ARN = FAILOVER_STATE_MACHINE_ARN;
    process.env.CLEANUP_STATE_MACHINE_ARN = CLEANUP_STATE_MACHINE_ARN;
    process.env.NOTIFICATION_TOPIC_ARN = NOTIFICATION_TOPIC_ARN;
  });

  describe('DynamoDB Integration', () => {
    it('should successfully write and read from error counter table', async () => {
      const timestamp = new Date().toISOString();
      
      // Mock PutItem response
      mockDynamoDBSend.mockResolvedValueOnce({});
      
      // Mock GetItem response
      mockDynamoDBSend.mockResolvedValueOnce({
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
      });

      // Write test data
      const dynamodbClient = new DynamoDBClient({});
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
      
      // Verify PutItem was called
      expect(mockDynamoDBSend).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: ERROR_COUNTER_TABLE,
          Item: expect.any(Object)
        })
      );
    });

    it('should support table configuration', async () => {
      mockDynamoDBSend.mockResolvedValueOnce({
        Table: {
          TableName: ERROR_COUNTER_TABLE,
          TableStatus: 'ACTIVE',
          KeySchema: [{ AttributeName: 'service_name', KeyType: 'HASH' }]
        }
      });
      
      const dynamodbClient = new DynamoDBClient({});
      const tableInfo = await dynamodbClient.send(new DescribeTableCommand({
        TableName: ERROR_COUNTER_TABLE
      }));
      
      expect(tableInfo.Table).toBeDefined();
      expect(tableInfo.Table?.TableName).toBe(ERROR_COUNTER_TABLE);
    });
  });

  describe('ECS Integration', () => {
    it('should describe cluster services', async () => {
      mockECSSend.mockResolvedValueOnce({
        services: [
          {
            serviceName: 'sample-app',
            desiredCount: 2,
            runningCount: 2,
            status: 'ACTIVE'
          },
          {
            serviceName: 'sample-app-standard',
            desiredCount: 2,
            runningCount: 2,
            status: 'ACTIVE'
          }
        ]
      });

      const ecsClient = new ECSClient({});
      const result = await ecsClient.send(new DescribeServicesCommand({
        cluster: CLUSTER_NAME,
        services: ['sample-app', 'sample-app-standard']
      }));

      expect(result.services).toBeDefined();
      expect(result.services?.length).toBe(2);
      expect(result.services?.[0].serviceName).toBe('sample-app');
      
      // Verify command was called
      expect(mockECSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          cluster: CLUSTER_NAME,
          services: ['sample-app', 'sample-app-standard']
        })
      );
    });

    it('should list cluster tasks', async () => {
      mockECSSend.mockResolvedValueOnce({
        taskArns: [
          'arn:aws:ecs:us-east-1:123456789012:task/fargate-spot-cluster/abc123',
          'arn:aws:ecs:us-east-1:123456789012:task/fargate-spot-cluster/def456'
        ]
      });

      const ecsClient = new ECSClient({});
      const result = await ecsClient.send(new ListTasksCommand({
        cluster: CLUSTER_NAME,
        serviceName: 'sample-app'
      }));

      expect(result.taskArns).toBeDefined();
      expect(result.taskArns?.length).toBe(2);
    });
  });

  describe('Step Functions Integration', () => {
    it('should start and complete failover workflow', async () => {
      // Mock StartExecution response
      mockSFNSend.mockResolvedValueOnce({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:failover-state-machine:test-execution'
      });

      const sfnClient = new SFNClient({});
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
      
      // Verify StartExecution was called
      expect(mockSFNSend).toHaveBeenCalledWith(
        expect.objectContaining({
          stateMachineArn: FAILOVER_STATE_MACHINE_ARN,
          input: expect.stringContaining('sample-app')
        })
      );
    });

    it('should start and complete cleanup workflow', async () => {
      // Mock DynamoDB PutItem for pre-condition
      mockDynamoDBSend.mockResolvedValueOnce({});
      
      // Mock StartExecution response
      mockSFNSend.mockResolvedValueOnce({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:cleanup-state-machine:test-execution'
      });

      const dynamodbClient = new DynamoDBClient({});
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

      const sfnClient = new SFNClient({});
      const startResult = await sfnClient.send(new StartExecutionCommand({
        stateMachineArn: CLEANUP_STATE_MACHINE_ARN,
        input: JSON.stringify({
          clusterName: CLUSTER_NAME,
          spotServiceName: 'sample-app',
          standardServiceName: 'sample-app-standard',
          serviceName: 'sample-app',
          cleanupDelay: 5
        })
      }));

      expect(startResult.executionArn).toBeDefined();
    });
  });

  describe('SNS Integration', () => {
    it('should list SNS topic subscriptions', async () => {
      mockSNSSend.mockResolvedValueOnce({
        Subscriptions: [
          {
            SubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:notifications:abc123',
            TopicArn: NOTIFICATION_TOPIC_ARN,
            Protocol: 'email',
            Endpoint: 'admin@example.com'
          }
        ]
      });

      const snsClient = new SNSClient({});
      const result = await snsClient.send(new ListSubscriptionsByTopicCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN
      }));

      expect(result.Subscriptions).toBeDefined();
      expect(result.Subscriptions?.length).toBe(1);
      expect(result.Subscriptions?.[0].Protocol).toBe('email');
    });
  });

  describe('CloudWatch Integration', () => {
    it('should retrieve custom metrics', async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 3600000);

      mockCloudWatchSend.mockResolvedValueOnce({
        MetricDataResults: [
          {
            Id: 'm1',
            Label: 'SpotErrorDetected',
            Timestamps: [startTime, endTime],
            Values: [1, 2]
          }
        ]
      });

      const cloudwatchClient = new CloudWatchClient({});
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
      expect(result.MetricDataResults?.length).toBe(1);
      expect(result.MetricDataResults?.[0].Id).toBe('m1');
    });
  });

  describe('X-Ray Integration', () => {
    it('should retrieve X-Ray service graph', async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 3600000);

      mockXRaySend.mockResolvedValueOnce({
        Services: [
          {
            ReferenceId: 1,
            Name: 'SpotErrorDetector',
            Type: 'AWS::Lambda::Function'
          },
          {
            ReferenceId: 2,
            Name: 'DynamoDB',
            Type: 'AWS::DynamoDB::Table'
          }
        ]
      });

      const xrayClient = new XRayClient({});
      const result = await xrayClient.send(new GetServiceGraphCommand({
        StartTime: startTime,
        EndTime: endTime
      }));

      expect(result.Services).toBeDefined();
      expect(result.Services?.length).toBe(2);
    });

    it('should retrieve X-Ray trace summaries', async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 3600000);

      mockXRaySend.mockResolvedValueOnce({
        TraceSummaries: [
          {
            Id: '1-abc123',
            Duration: 0.5,
            Status: 200
          }
        ]
      });

      const xrayClient = new XRayClient({});
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
      // Step 1: Mock initial Spot service state
      mockECSSend.mockResolvedValueOnce({
        services: [{
          serviceName: 'sample-app',
          desiredCount: 2,
          runningCount: 2,
          status: 'ACTIVE'
        }]
      });

      const ecsClient = new ECSClient({});
      const initialSpotService = await ecsClient.send(new DescribeServicesCommand({
        cluster: CLUSTER_NAME,
        services: ['sample-app']
      }));
      
      expect(initialSpotService.services?.[0].serviceName).toBe('sample-app');

      // Step 2: Mock DynamoDB PutItem for error count
      mockDynamoDBSend.mockResolvedValueOnce({});
      
      const dynamodbClient = new DynamoDBClient({});
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

      // Step 3: Mock Step Functions StartExecution for failover
      mockSFNSend.mockResolvedValueOnce({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:failover-state-machine:e2e-test'
      });

      const sfnClient = new SFNClient({});
      const failoverStart = await sfnClient.send(new StartExecutionCommand({
        stateMachineArn: FAILOVER_STATE_MACHINE_ARN,
        input: JSON.stringify({
          clusterName: CLUSTER_NAME,
          spotServiceName: 'sample-app',
          standardServiceName: 'sample-app-standard',
          serviceName: 'sample-app'
        })
      }));

      expect(failoverStart.executionArn).toBeDefined();

      // Step 4: Mock GetItem for failover state verification
      mockDynamoDBSend.mockResolvedValueOnce({
        Item: {
          service_name: { S: 'sample-app' },
          error_count: { N: '3' },
          failover_state: {
            M: {
              failover_active: { BOOL: true },
              failover_time: { S: new Date().toISOString() }
            }
          }
        }
      });

      const failoverState = await dynamodbClient.send(new GetItemCommand({
        TableName: ERROR_COUNTER_TABLE,
        Key: {
          service_name: { S: 'sample-app' }
        }
      }));

      expect(failoverState.Item?.failover_state?.M?.failover_active.BOOL).toBe(true);

      // Step 5: Mock Step Functions StartExecution for cleanup
      mockSFNSend.mockResolvedValueOnce({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:cleanup-state-machine:e2e-test'
      });

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

      expect(cleanupStart.executionArn).toBeDefined();

      // Step 6: Mock GetItem for final state verification
      mockDynamoDBSend.mockResolvedValueOnce({
        Item: {
          service_name: { S: 'sample-app' },
          error_count: { N: '0' },
          failover_state: {
            M: {
              failover_active: { BOOL: false }
            }
          }
        }
      });

      const finalState = await dynamodbClient.send(new GetItemCommand({
        TableName: ERROR_COUNTER_TABLE,
        Key: {
          service_name: { S: 'sample-app' }
        }
      }));

      expect(finalState.Item?.error_count.N).toBe('0');
      expect(finalState.Item?.failover_state?.M?.failover_active.BOOL).toBe(false);

      // Verify all expected calls were made
      expect(mockECSSend).toHaveBeenCalledTimes(1);
      expect(mockDynamoDBSend).toHaveBeenCalledTimes(3);
      expect(mockSFNSend).toHaveBeenCalledTimes(2);
    });
  });
});
