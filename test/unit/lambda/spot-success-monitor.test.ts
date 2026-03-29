import { jest } from '@jest/globals';
import { handler } from '../../../src/lambda/spot-success-monitor';
import { mockDynamoDBSend, mockSFNSend, mockSNSSend } from '../../setup';

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('Spot Success Monitor Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  // Helper to check if mockSFNSend was called (SFN uses Step Functions, not Lambda)
  const expectSFNStartExecution = () => {
    expect(mockSFNSend).toHaveBeenCalled();
  };

  describe('Event validation', () => {
    it('should skip when no detail in event', async () => {
      const event = { source: 'aws.ecs' };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('No detail in event');
      expect(mockDynamoDBSend).not.toHaveBeenCalled();
    });

    it('should skip when task status is not RUNNING', async () => {
      const event = {
        detail: {
          lastStatus: 'STOPPED',
        },
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Task not running');
      expect(mockDynamoDBSend).not.toHaveBeenCalled();
    });
  });

  describe('Spot task detection', () => {
    it('should detect FARGATE_SPOT capacity provider', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          error_count: 0,
          failover_state: null,
        },
      });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Spot success processed successfully');
    });

    it('should detect Spot from group name', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-spot-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE',
        },
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          error_count: 0,
          failover_state: null,
        },
      });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
    });

    it('should skip non-Spot tasks', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE',
        },
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          error_count: 0,
          failover_state: null,
        },
      });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Not a Spot task');
    });
  });

  describe('Error count reset', () => {
    it('should reset error count when errors exist', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({
          Item: {
            error_count: 5,
            failover_state: null,
          },
        })
        .mockResolvedValueOnce({});

      const result = await handler(event as any);

      expect(mockDynamoDBSend).toHaveBeenCalledWith(
        expect.objectContaining({
          UpdateExpression: expect.stringContaining('error_count = :zero'),
        })
      );
      expect(JSON.parse(result.body).errorCountReset).toBe(true);
    });

    it('should not reset error count when no errors', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          error_count: 0,
          failover_state: null,
        },
      });

      const result = await handler(event as any);

      // Should only call get, not update
      expect(mockDynamoDBSend).toHaveBeenCalledTimes(1);
      expect(JSON.parse(result.body).errorCountReset).toBe(false);
    });
  });

  describe('Recovery triggering', () => {
    it('should trigger cleanup when failover is active', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({
          Item: {
            error_count: 0,
            failover_state: {
              failover_active: true,
            },
          },
        })
        .mockResolvedValueOnce({
          Item: {
            cleanup_in_progress: false,
          },
        })
        .mockResolvedValueOnce({});

      mockSFNSend.mockResolvedValue({});

      const result = await handler(event as any);

      expectSFNStartExecution();
      expect(JSON.parse(result.body).message).toBe('Cleanup triggered successfully');
    });

    it('should not trigger cleanup when no failover active', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          error_count: 0,
          failover_state: null,
        },
      });

      const result = await handler(event as any);

      expect(mockSFNSend).not.toHaveBeenCalled();
      expect(JSON.parse(result.body).message).toBe('Spot success processed successfully');
    });

    it('should not trigger cleanup when already in progress', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({
          Item: {
            error_count: 0,
            failover_state: {
              failover_active: true,
            },
          },
        })
        .mockResolvedValueOnce({
          Item: {
            cleanup_in_progress: true,
          },
        });

      const result = await handler(event as any);

      expect(mockSFNSend).not.toHaveBeenCalled();
      expect(JSON.parse(result.body).message).toBe('Cleanup already in progress');
    });

    it('should mark cleanup as in progress before triggering', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({
          Item: {
            error_count: 0,
            failover_state: {
              failover_active: true,
            },
          },
        })
        .mockResolvedValueOnce({
          Item: {
            cleanup_in_progress: false,
          },
        })
        .mockResolvedValueOnce({});

      mockSFNSend.mockResolvedValue({});

      await handler(event as any);

      // Verify cleanup_in_progress is set to true before invoking cleanup
      const markCleanupCall = mockDynamoDBSend.mock.calls.find(
        (call: any[]) => call[0].UpdateExpression && call[0].UpdateExpression.includes('cleanup_in_progress')
      );
      expect(markCleanupCall).toBeDefined();
      expect((markCleanupCall as any)[0].ExpressionAttributeValues[':status']).toBe(true);
      
      // Verify SFN was called
      expectSFNStartExecution();
    });
  });

  describe('Service name extraction', () => {
    it('should extract service name from group', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:my-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          error_count: 0,
          failover_state: null,
        },
      });

      const result = await handler(event as any);

      expect(JSON.parse(result.body).serviceName).toBe('my-service');
    });

    it('should use unknown-service when group is empty', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: undefined,
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          error_count: 0,
          failover_state: null,
        },
      });

      const result = await handler(event as any);

      expect(JSON.parse(result.body).serviceName).toBe('unknown-service');
    });
  });

  describe('Error handling', () => {
    it('should handle DynamoDB errors gracefully', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      // getServiceState catches errors and returns default values (error_count: 0, failover_state: null)
      // so handler continues with normal flow without triggering failover
      mockDynamoDBSend.mockRejectedValue(new Error('DynamoDB connection failed'));

      const result = await handler(event as any);
      
      // Handler returns 200 with service state using default values
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).serviceName).toBe('test-service');
      // No SNS notification since error is handled gracefully in getServiceState
      expect(mockSNSSend).not.toHaveBeenCalled();
    });

    it('should handle Step Functions start execution errors', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({
          Item: {
            error_count: 0,
            failover_state: {
              failover_active: true,
            },
          },
        })
        .mockResolvedValueOnce({
          Item: {
            cleanup_in_progress: false,
          },
        })
        .mockResolvedValueOnce({});

      mockSFNSend.mockRejectedValue(new Error('SFN start execution failed'));
      mockSNSSend.mockResolvedValue({});

      await expect(handler(event as any)).rejects.toThrow('SFN start execution failed');
    });

    it('should send notification on error', async () => {
      const event = {
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          capacityProviderName: 'FARGATE_SPOT',
        },
      };

      // Force an error during processing by rejecting SFN call
      mockDynamoDBSend
        .mockResolvedValueOnce({
          Item: {
            error_count: 0,
            failover_state: {
              failover_active: true,
            },
          },
        })
        .mockResolvedValueOnce({
          Item: {
            cleanup_in_progress: false,
          },
        })
        .mockResolvedValueOnce({});
      
      mockSFNSend.mockRejectedValue(new Error('Test error'));
      mockSNSSend.mockResolvedValue({});

      try {
        await handler(event as any);
      } catch (e) {
        // Expected to throw
      }

      expect(mockSNSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Subject: 'ECS Spot Failover System Error',
          Message: expect.stringContaining('SpotSuccessMonitor'),
        })
      );
    });
  });
});
