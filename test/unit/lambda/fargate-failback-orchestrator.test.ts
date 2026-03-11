import { jest } from '@jest/globals';
import { handler } from '../../../src/lambda/fargate-failback-orchestrator';
import { ECSClient } from '@aws-sdk/client-ecs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('Fargate Failback Orchestrator Lambda', () => {
  let mockECSSend: jest.Mock;
  let mockDynamoDBSend: jest.Mock;
  let mockSNSSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();

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
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('Event parsing', () => {
    it('should handle direct invocation with serviceName', async () => {
      const event = {
        serviceName: 'test-service',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
      };

      mockDynamoDBSend.mockResolvedValue({ Item: null });

      mockECSSend
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
    });

    it('should handle EventBridge event format', async () => {
      const event = {
        detail: {
          group: 'service:test-service',
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
        },
      };

      mockDynamoDBSend.mockResolvedValue({ Item: null });

      mockECSSend
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
    });

    it('should use CLUSTER_NAME from env when clusterArn not provided', async () => {
      const event = {
        serviceName: 'test-service',
      };

      mockDynamoDBSend.mockResolvedValue({ Item: null });

      mockECSSend
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
    });

    it('should return error when serviceName cannot be determined', async () => {
      const event = {};

      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('Unable to determine service name');
    });

    it('should return error when clusterName cannot be determined', async () => {
      const event = {
        serviceName: 'test-service',
      };

      // Temporarily remove CLUSTER_NAME from env
      const originalClusterName = process.env.CLUSTER_NAME;
      delete process.env.CLUSTER_NAME;

      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('Cluster name is required');

      // Restore env
      process.env.CLUSTER_NAME = originalClusterName;
    });
  });

  describe('Failover already active', () => {
    it('should skip when failover already active', async () => {
      const event = {
        serviceName: 'test-service',
      };

      mockDynamoDBSend.mockResolvedValue({
        Item: {
          failover_state: {
            failover_active: true,
          },
        },
      });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Failover already active');
      expect(mockECSSend).not.toHaveBeenCalled();
    });
  });

  describe('Failover execution', () => {
    const createMockEvent = () => ({
      serviceName: 'test-service',
      clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
    });

    beforeEach(() => {
      mockDynamoDBSend.mockResolvedValue({ Item: null });
    });

    it('should start standard service with correct desired count', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      await handler(event as any);

      // Verify standard service is started with desired count matching spot service
      expect(mockECSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          cluster: 'test-cluster',
          service: 'test-service-standard',
          desiredCount: 2,
        })
      );
    });

    it('should stop spot service after standard is stable', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} }) // Update standard service
        .mockResolvedValueOnce({ service: {} }) // Update spot service
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      await handler(event as any);

      // Verify spot service is stopped
      expect(mockECSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          cluster: 'test-cluster',
          service: 'test-service',
          desiredCount: 0,
        })
      );
    });

    it('should update DynamoDB with failover state', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      await handler(event as any);

      // Verify failover state is updated
      expect(mockDynamoDBSend).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-error-counter-table',
          UpdateExpression: expect.stringContaining('failover_state'),
        })
      );
    });

    it('should reset error count after failover', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }],
        });

      await handler(event as any);

      // Verify error count is reset
      const resetCall = mockDynamoDBSend.mock.calls.find(
        call => call[0].UpdateExpression && call[0].UpdateExpression.includes('error_count = :zero')
      );
      expect(resetCall).toBeDefined();
    });

    it('should send success notification', async () => {
      const event = createMockEvent();

      mockECSSend
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }),
        });

      await handler(event as any);

      expect(mockSNSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Subject: 'ECS Spot Failover Completed Successfully',
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle ECS service not found', async () => {
      const event = {
        serviceName: 'test-service',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
      };

      mockDynamoDBSend.mockResolvedValue({ Item: null });

      mockECSSend.mockResolvedValueOnce({
        services: [],
      });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('not found');
    });

    it('should handle ECS update failure', async () => {
      const event = {
        serviceName: 'test-service',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
      };

      mockDynamoDBSend.mockResolvedValue({ Item: null });

      mockECSSend
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockRejectedValueOnce(new Error('Service update failed'));

      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      expect(mockSNSSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Subject: 'ECS Spot Failover Failed',
        })
      );
    });

    it('should handle DynamoDB update failure during cleanup', async () => {
      const event = {
        serviceName: 'test-service',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
      };

      mockDynamoDBSend
        .mockResolvedValueOnce({ Item: null })
        .mockRejectedValueOnce(new Error('DynamoDB update failed'));

      mockECSSend
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({ service: {} })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service-standard',
            desiredCount: 2,
            runningCount: 2,
            pendingCount: 0,
          }],
        })
        .mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            desiredCount: 0,
            runningCount: 0,
            pendingCount: 0,
          }),
        });

      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
    });
  });
});
