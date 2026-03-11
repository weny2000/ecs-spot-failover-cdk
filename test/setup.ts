// Jest setup file
import { jest } from '@jest/globals';

// Mock AWS SDK v3 clients
jest.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  DescribeServicesCommand: jest.fn().mockImplementation((params) => params),
  UpdateServiceCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
  },
  GetCommand: jest.fn().mockImplementation((params) => params),
  UpdateCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  PublishCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  InvokeCommand: jest.fn().mockImplementation((params) => params),
}));

// Set default environment variables
process.env.ERROR_COUNTER_TABLE = 'test-error-counter-table';
process.env.NOTIFICATION_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-topic';
process.env.CLUSTER_NAME = 'test-cluster';
process.env.FAILURE_THRESHOLD = '3';
process.env.CLEANUP_DELAY = '30';
process.env.SERVICE_STABLE_TIMEOUT = '300';
process.env.FAILOVER_ORCHESTRATOR_FUNCTION_NAME = 'test-failover-orchestrator';
process.env.CLEANUP_ORCHESTRATOR_FUNCTION_NAME = 'test-cleanup-orchestrator';
