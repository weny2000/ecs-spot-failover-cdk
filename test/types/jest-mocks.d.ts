// Type declarations for Jest mocks in tests
// This file provides proper typing for AWS SDK mocks in test files

import 'jest';

declare module '@aws-sdk/lib-dynamodb' {
  interface DynamoDBDocumentClient {
    send: jest.Mock<any, any>;
  }
  
  interface GetCommandOutput {
    Item?: Record<string, any>;
  }
  
  interface UpdateCommandOutput {
    Attributes?: Record<string, any>;
  }
  
  interface PutCommandOutput {
    Attributes?: Record<string, any>;
  }
}

declare module '@aws-sdk/client-sns' {
  interface SNSClient {
    send: jest.Mock<any, any>;
  }
}

declare module '@aws-sdk/client-lambda' {
  interface LambdaClient {
    send: jest.Mock<any, any>;
  }
}

declare module '@aws-sdk/client-ecs' {
  interface ECSClient {
    send: jest.Mock<any, any>;
  }
}

declare global {
  // Allow jest.Mock to accept any arguments
  type MockedFunction<T extends (...args: any[]) => any> = jest.Mock<ReturnType<T>, Parameters<T>>;
}

export {};
