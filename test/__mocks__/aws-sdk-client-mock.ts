// Helper functions for mocking AWS SDK v3 clients
import { jest } from '@jest/globals';

export type MockedFunction<T extends (...args: any[]) => any> = jest.MockedFunction<T>;

export interface MockAWSSendResult {
  promise?: () => Promise<any>;
  [key: string]: any;
}

export function createMockSend(result: any = {}): jest.Mock {
  return jest.fn().mockResolvedValue(result);
}

export function createMockSendSequence(results: any[]): jest.Mock {
  let callIndex = 0;
  return jest.fn().mockImplementation(() => {
    const result = results[callIndex] || {};
    callIndex++;
    return Promise.resolve(result);
  });
}

export function createMockSendError(error: Error): jest.Mock {
  return jest.fn().mockRejectedValue(error);
}

// Helper to create ECS service mock
export function createECSServiceMock(overrides: Partial<any> = {}): any {
  return {
    serviceName: 'test-service',
    desiredCount: 2,
    runningCount: 2,
    pendingCount: 0,
    deployments: [],
    ...overrides,
  };
}

// Helper to create DynamoDB item mock
export function createDynamoDBItemMock(overrides: Partial<any> = {}): any {
  return {
    Item: {
      service_name: 'test-service',
      error_count: 0,
      failover_state: null,
      ...overrides,
    },
  };
}

// Helper to create EventBridge event mock
export function createEventBridgeEventMock(overrides: Partial<any> = {}): any {
  return {
    version: '0',
    id: 'test-event-id',
    'detail-type': 'ECS Task State Change',
    source: 'aws.ecs',
    account: '123456789012',
    time: new Date().toISOString(),
    region: 'us-east-1',
    detail: {
      clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
      taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-task',
      group: 'service:test-service',
      lastStatus: 'STOPPED',
      stoppedReason: 'Task stopped due to SpotInterruption',
      ...overrides,
    },
  };
}

// Reset all mocks helper
export function resetAllMockClients(): void {
  jest.clearAllMocks();
}
