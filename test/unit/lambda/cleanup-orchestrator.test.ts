import { jest } from '@jest/globals';
import { handler } from '../../../src/lambda/cleanup-orchestrator';
import { ECSClient } from '@aws-sdk/client-ecs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

describe('Cleanup Orchestrator Lambda', () => {
  let mockECSSend: jest.Mock;
  let mockDynamoDBSend: jest.Mock;
  let mockSNSSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();

    mockECSSend = jest.fn();
    mockDynamoDBSend = jest.fn();
    mockSNSSend = jest.fn();

    (ECSClient as jest.Mock).mockImplementation(() => ({
      send: mockECSSend,
    }));

    (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({
      send: mockDynamoDBSend,
    });

    (SNSClient as jest.Mock).mockImplementation(() => ({
      send: mockSNSSend,
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  describe('Event parsing', () => {
    it('should handle direct invocation with serviceName', async () => {
      const event = {
        serviceName: 'test-service',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          failover_state: {
            failover_active: true,
            original_desired_count: 2,
          },
        },
      });

      mockECSSend
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      const resultPromise = handler(event as any);
      jest.advanceTimersByTime(30000); // Advance past CLEANUP_DELAY
      const result = await resultPromise;

      expect(result.statusCode).toBe(200);
    });

    it('should handle EventBridge event format', async () => {
      const event = {
        detail: {
          group: 'service:test-service',
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
        },
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          failover_state: {
            failover_active: true,
            original_desired_count: 2,
          },
        },
      });

      mockECSSend
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      const resultPromise = handler(event as any);
      jest.advanceTimersByTime(30000);
      const result = await resultPromise;

      expect(result.statusCode).toBe(200);
    });

    it('should return error when serviceName cannot be determined', async () => {
      const event = {};

      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('Unable to determine service name');
    });
  });

  describe('Skip conditions', () => {
    it('should skip when no failover state exists', async () => {
      const event = {
        serviceName: 'test-service',
      };

      mockDynamoDBSend.mockResolvedValue({ Item: null });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).status).toBe('skipped');
      expect(mockECSSend).not.toHaveBeenCalled();
    });

    it('should skip when failover is not active', async () => {
      const event = {
        serviceName: 'test-service',
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          failover_state: {
            failover_active: false,
          },
        },
      });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).status).toBe('skipped');
      expect(mockECSSend).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup execution', () => {
    const createMockEvent = () => ({
      serviceName: 'test-service',
      clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
    });

    beforeEach(() => {
      mockDynamoDBSend.mockResolvedValue({
        Item: {
          failover_state: {
            failover_active: true,
            original_desired_count: 2,
          },
        },
      });
    });

    it('should wait for CLEANUP_DELAY before starting cleanup', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      const handlerPromise = handler(event as any);
      
      // Should not have called ECS yet
      expect(mockECSSend).not.toHaveBeenCalled();

      // Advance time
      jest.advanceTimersByTime(30000);

      await handlerPromise;

      // Now ECS should be called
      expect(mockECSSend).toHaveBeenCalled();
    });

    it('should restore Spot service with original desired count', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      const handlerPromise = handler(event as any);
      jest.advanceTimersByTime(30000);
      await handlerPromise;

      // Verify Spot service is restored
      expect(mockECSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          cluster: 'test-cluster',
          service: 'test-service',
          desiredCount: 2,
        })
      );
    });

    it('should stop standard service after Spot is stable', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({ service: {} }) // Update Spot service
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} }) // Update standard service
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      const handlerPromise = handler(event as any);
      jest.advanceTimersByTime(30000);
      await handlerPromise;

      // Verify standard service is stopped
      expect(mockECSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          cluster: 'test-cluster',
          service: 'test-service-standard',
          desiredCount: 0,
        })
      );
    });

    it('should clear failover state in DynamoDB', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }),
        });

      const handlerPromise = handler(event as any);
      jest.advanceTimersByTime(30000);
      await handlerPromise;

      // Verify failover state is cleared
      expect(mockDynamoDBSend).toHaveBeenCalledWith(
        expect.objectContaining({
          UpdateExpression: expect.stringContaining('failover_state'),
        })
      );
    });

    it('should reset error count after cleanup', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }),
        });

      const handlerPromise = handler(event as any);
      jest.advanceTimersByTime(30000);
      await handlerPromise;

      // Verify error count is reset
      const resetCall = mockDynamoDBSend.mock.calls.find(
        call => call[0].UpdateExpression && call[0].UpdateExpression.includes('error_count = :zero')
      );
      expect(resetCall).toBeDefined();
    });

    it('should send success notification', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }),
        });

      const handlerPromise = handler(event as any);
      jest.advanceTimersByTime(30000);
      await handlerPromise;

      expect(mockSNSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Subject: 'ECS Spot Recovery Completed Successfully',
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle Spot service stabilization timeout', async () => {
      const event = {
        serviceName: 'test-service',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          failover_state: {
            failover_active: true,
            original_desired_count: 2,
          },
        },
      });

      mockECSSend
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 1, // Not stable
            pendingCount: 1,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }),
        });

      const handlerPromise = handler(event as any);
      jest.advanceTimersByTime(30000 + 300000); // CLEANUP_DELAY + timeout
      const result = await handlerPromise;

      expect(result.statusCode).toBe(200);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('did not stabilize')
      );
    });

    it('should handle cleanup failure', async () => {
      const event = {
        serviceName: 'test-service',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          failover_state: {
            failover_active: true,
            original_desired_count: 2,
          },
        },
      });

      mockECSSend.mockRejectedValue(new Error('ECS update failed'));

      const handlerPromise = handler(event as any);
      jest.advanceTimersByTime(30000);
      const result = await handlerPromise;

      expect(result.statusCode).toBe(500);
      expect(mockSNSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Subject: 'ECS Spot Recovery Failed',
        })
      );
    });

    it('should mark cleanup as not in progress on failure', async () => {
      const event = {
        serviceName: 'test-service',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({
          Item: {
            failover_state: {
              failover_active: true,
              original_desired_count: 2,
            },
          },
        })
        .mockRejectedValueOnce(new Error('DynamoDB error'));

      mockECSSend.mockRejectedValue(new Error('ECS error'));

      const handlerPromise = handler(event as any);
      jest.advanceTimersByTime(30000);
      await handlerPromise;

      // Verify cleanup_in_progress is set to false
      const cleanupResetCall = mockDynamoDBSend.mock.calls.find(
        call => call[0].UpdateExpression && call[0].UpdateExpression.includes('cleanup_in_progress')
      );
      expect(cleanupResetCall).toBeDefined();
    });
  });
});
