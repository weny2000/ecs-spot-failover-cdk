// Jest setup file
import { jest } from '@jest/globals';

// Mock X-Ray SDK before any AWS SDK imports
jest.mock('aws-xray-sdk-core', () => ({
  captureAWSv3Client: jest.fn().mockImplementation((client: any) => client),
  getSegment: jest.fn().mockReturnValue(null),
  segmentUtils: {
    getTraceData: jest.fn().mockReturnValue({}),
  },
  setContextMissingStrategy: jest.fn(),
}));

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

// Shared mock send function that can be accessed by tests
export const mockDynamoDBSend = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({
      send: mockDynamoDBSend,
    })),
  },
  GetCommand: jest.fn().mockImplementation((params) => params),
  UpdateCommand: jest.fn().mockImplementation((params) => params),
  PutCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: mockSNSSend,
  })),
  PublishCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  InvokeCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  PutMetricDataCommand: jest.fn().mockImplementation((params) => params),
}));

// Shared mocks for SFN and SNS
export const mockSFNSend = jest.fn();
export const mockSNSSend = jest.fn();

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({
    send: mockSFNSend,
  })),
  StartExecutionCommand: jest.fn().mockImplementation((params) => params),
}));

// Reset shared mocks before each test
beforeEach(() => {
  mockDynamoDBSend.mockReset();
  mockSFNSend.mockReset();
  mockSNSSend.mockReset();
});

// Set default environment variables
process.env.ERROR_COUNTER_TABLE = 'test-error-counter-table';
process.env.NOTIFICATION_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-topic';
process.env.CLUSTER_NAME = 'test-cluster';
process.env.FAILURE_THRESHOLD = '3';
process.env.CLEANUP_DELAY = '30';
process.env.SERVICE_STABLE_TIMEOUT = '300';
process.env.FAILOVER_ORCHESTRATOR_FUNCTION_NAME = 'test-failover-orchestrator';
process.env.CLEANUP_ORCHESTRATOR_FUNCTION_NAME = 'test-cleanup-orchestrator';
process.env.FAILOVER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:test-failover';
process.env.CLEANUP_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:test-cleanup';
