import { jest } from '@jest/globals';
import { handler } from '../../../src/lambda/spot-error-detector';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { LambdaClient } from '@aws-sdk/client-lambda';

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('Spot Error Detector Lambda', () => {
  let mockDynamoDBSend: jest.Mock;
  let mockSNSSend: jest.Mock;
  let mockLambdaSend: jest.Mock;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Suppress console output during tests
    console.log = jest.fn();
    console.error = jest.fn();

    // Setup mock implementations
    mockDynamoDBSend = jest.fn();
    mockSNSSend = jest.fn();
    mockLambdaSend = jest.fn();

    (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({
      send: mockDynamoDBSend,
    });

    (SNSClient as jest.Mock).mockImplementation(() => ({
      send: mockSNSSend,
    }));

    (LambdaClient as jest.Mock).mockImplementation(() => ({
      send: mockLambdaSend,
    }));
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('Event validation', () => {
    it('should skip when no detail in event', async () => {
      const event = { source: 'aws.ecs' };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('No detail in event');
      expect(mockDynamoDBSend).not.toHaveBeenCalled();
    });

    it('should skip when task status is not STOPPED', async () => {
      const event = {
        detail: {
          lastStatus: 'RUNNING',
          stoppedReason: 'Task stopped due to SpotInterruption',
        },
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Task not stopped');
      expect(mockDynamoDBSend).not.toHaveBeenCalled();
    });

    it('should skip when not a Spot error', async () => {
      const event = {
        detail: {
          lastStatus: 'STOPPED',
          stoppedReason: 'Essential container in task exited',
        },
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Not a Spot error');
      expect(mockDynamoDBSend).not.toHaveBeenCalled();
    });
  });

  describe('Error detection', () => {
    it('should detect SpotInterruption error', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'Task stopped due to SpotInterruption',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 1 } }) // updateErrorCount
        .mockResolvedValueOnce({ Item: null }); // check failover state

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(mockDynamoDBSend).toHaveBeenCalledTimes(2);
      expect(mockSNSSend).toHaveBeenCalled(); // Notification sent
    });

    it('should detect ResourcesNotAvailable error', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'ResourcesNotAvailable: Spot capacity unavailable',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 1 } })
        .mockResolvedValueOnce({ Item: null });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(mockDynamoDBSend).toHaveBeenCalledTimes(2);
    });

    it('should detect insufficient capacity error', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'insufficient capacity in availability zone',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 1 } })
        .mockResolvedValueOnce({ Item: null });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('Error counting', () => {
    it('should increment error count in DynamoDB', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'SpotInterruption',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 1 } })
        .mockResolvedValueOnce({ Item: null });

      await handler(event as any);

      expect(mockDynamoDBSend).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-error-counter-table',
          Key: { service_name: 'test-service' },
          UpdateExpression: expect.stringContaining('error_count'),
        })
      );
    });

    it('should extract service name from group', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:my-custom-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'SpotInterruption',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 1 } })
        .mockResolvedValueOnce({ Item: null });

      await handler(event as any);

      expect(mockDynamoDBSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { service_name: 'my-custom-service' },
        })
      );
    });

    it('should use unknown-service when group is empty', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: undefined,
          lastStatus: 'STOPPED',
          stoppedReason: 'SpotInterruption',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 1 } })
        .mockResolvedValueOnce({ Item: null });

      await handler(event as any);

      expect(mockDynamoDBSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { service_name: 'unknown-service' },
        })
      );
    });
  });

  describe('Failover triggering', () => {
    it('should trigger failover when threshold reached', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'SpotInterruption',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 3 } }) // Threshold reached
        .mockResolvedValueOnce({ Item: null }); // No active failover

      mockLambdaSend.mockResolvedValueOnce({});

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(mockLambdaSend).toHaveBeenCalledWith(
        expect.objectContaining({
          FunctionName: 'test-failover-orchestrator',
          InvocationType: 'Event',
        })
      );
    });

    it('should not trigger failover when below threshold', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'SpotInterruption',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 2 } }) // Below threshold
        .mockResolvedValueOnce({ Item: null });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(mockLambdaSend).not.toHaveBeenCalled();
    });

    it('should not trigger failover if already active', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'SpotInterruption',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 3 } })
        .mockResolvedValueOnce({
          Item: {
            failover_state: {
              failover_active: true,
            },
          },
        });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe(JSON.stringify({ message: 'Failover already active' }));
      expect(mockLambdaSend).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle DynamoDB errors gracefully', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'SpotInterruption',
        },
      };

      mockDynamoDBSend.mockRejectedValue(new Error('DynamoDB connection failed'));

      await expect(handler(event as any)).rejects.toThrow('DynamoDB connection failed');
    });

    it('should send notification on error detection', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'SpotInterruption',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 1 } })
        .mockResolvedValueOnce({ Item: null });

      await handler(event as any);

      expect(mockSNSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
          Subject: 'ECS Spot Instance Error Detected',
        })
      );
    });

    it('should handle SNS notification errors gracefully', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          stoppedReason: 'SpotInterruption',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Attributes: { error_count: 1 } })
        .mockResolvedValueOnce({ Item: null });

      mockSNSSend.mockRejectedValue(new Error('SNS publish failed'));

      // Should not throw, just log error
      const result = await handler(event as any);
      expect(result.statusCode).toBe(200);
    });
  });
});
