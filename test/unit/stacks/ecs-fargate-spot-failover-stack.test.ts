import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EcsFargateSpotFailoverStack } from '../../../src/ecs-fargate-spot-failover-stack';

describe('EcsFargateSpotFailoverStack', () => {
  let app: App;
  let stack: EcsFargateSpotFailoverStack;
  let template: Template;

  beforeEach(() => {
    app = new App();
    stack = new EcsFargateSpotFailoverStack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-1',
      },
    });
    template = Template.fromStack(stack);
  });

  describe('VPC Configuration', () => {
    it('should create a VPC with 2 AZs', () => {
      template.hasResourceProperties('AWS::EC2::VPC', {
        CidrBlock: '10.0.0.0/16',
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });

      // Should have 2 public and 2 private subnets
      template.resourceCountIs('AWS::EC2::Subnet', 4);
    });

    it('should create a NAT Gateway', () => {
      template.hasResourceProperties('AWS::EC2::NatGateway', {
        ConnectivityType: 'public',
      });
    });
  });

  describe('ECS Cluster', () => {
    it('should create an ECS cluster', () => {
      template.hasResourceProperties('AWS::ECS::Cluster', {
        ClusterName: 'fargate-spot-cluster',
      });
    });

    it('should have capacity providers configured', () => {
      template.hasResourceProperties('AWS::ECS::ClusterCapacityProviderAssociations', {
        CapacityProviders: Match.arrayWith(['FARGATE', 'FARGATE_SPOT']),
      });
    });
  });

  describe('DynamoDB Table', () => {
    it('should create DynamoDB table with correct schema', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'fargate-spot-error-counter',
        KeySchema: [
          {
            AttributeName: 'service_name',
            KeyType: 'HASH',
          },
        ],
        AttributeDefinitions: [
          {
            AttributeName: 'service_name',
            AttributeType: 'S',
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    it('should have deletion policy for non-production', () => {
      template.hasResource('AWS::DynamoDB::Table', {
        DeletionPolicy: 'Delete',
      });
    });
  });

  describe('SNS Topic', () => {
    it('should create SNS topic for notifications', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'fargate-spot-failover-notifications',
      });
    });
  });

  describe('Lambda Functions', () => {
    it('should create 3 Lambda functions', () => {
      template.resourceCountIs('AWS::Lambda::Function', 3);
    });

    it('should create Spot Error Detector Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'spot-error-detector.handler',
        Runtime: 'nodejs18.x',
        Timeout: 30,
        Environment: {
          Variables: Match.objectLike({
            ERROR_COUNTER_TABLE: 'fargate-spot-error-counter',
            FAILURE_THRESHOLD: '3',
          }),
        },
      });
    });

    it('should create Failover Step Functions state machine', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        StateMachineName: 'ecs-spot-failover-workflow',
      });
    });

    it('should create Cleanup Step Functions state machine', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        StateMachineName: 'ecs-spot-cleanup-workflow',
      });
    });

    it('should create Spot Success Monitor Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'spot-success-monitor.handler',
        Runtime: 'nodejs18.x',
        Timeout: 30,
        Environment: {
          Variables: Match.objectLike({
            ERROR_COUNTER_TABLE: 'fargate-spot-error-counter',
            CLUSTER_NAME: 'fargate-spot-cluster',
          }),
        },
      });
    });
  });

  describe('IAM Roles', () => {
    it('should create Lambda execution role with correct permissions', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
            },
          ],
        },
      });
    });

    it('should have ECS permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'ecs:UpdateService',
                'ecs:DescribeServices',
              ]),
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('should have DynamoDB permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
              ]),
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('should have SNS permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sns:Publish',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('should have Step Functions permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'states:StartExecution',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('EventBridge Rules', () => {
    it('should create rule for STOPPED events', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
          source: ['aws.ecs'],
          'detail-type': ['ECS Task State Change'],
          detail: {
            lastStatus: ['STOPPED'],
          },
        },
      });
    });

    it('should create rule for RUNNING events', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
          source: ['aws.ecs'],
          'detail-type': ['ECS Task State Change'],
          detail: {
            lastStatus: ['RUNNING'],
          },
        },
      });
    });

    it('should connect STOPPED rule to Spot Error Detector', () => {
      const rules = template.findResources('AWS::Events::Rule', {
        EventPattern: {
          detail: {
            lastStatus: ['STOPPED'],
          },
        },
      });

      const ruleKeys = Object.keys(rules);
      expect(ruleKeys.length).toBe(1);

      const targets = rules[ruleKeys[0]].Properties.Targets;
      expect(targets.length).toBe(1);
      expect(targets[0].Arn['Fn::GetAtt'][0]).toMatch(/SpotErrorDetector/);
    });

    it('should connect RUNNING rule to Spot Success Monitor', () => {
      const rules = template.findResources('AWS::Events::Rule', {
        EventPattern: {
          detail: {
            lastStatus: ['RUNNING'],
          },
        },
      });

      const ruleKeys = Object.keys(rules);
      expect(ruleKeys.length).toBe(1);

      const targets = rules[ruleKeys[0]].Properties.Targets;
      expect(targets.length).toBe(1);
      expect(targets[0].Arn['Fn::GetAtt'][0]).toMatch(/SpotSuccessMonitor/);
    });
  });

  describe('ECS Services (Sample App)', () => {
    it('should create Spot Fargate service', () => {
      template.hasResourceProperties('AWS::ECS::Service', {
        ServiceName: 'sample-app',
        LaunchType: Match.absent(), // Uses capacity provider
        CapacityProviderStrategy: [
          {
            CapacityProvider: 'FARGATE_SPOT',
            Weight: 1,
          },
        ],
        DesiredCount: 2,
      });
    });

    it('should create Standard Fargate service', () => {
      template.hasResourceProperties('AWS::ECS::Service', {
        ServiceName: 'sample-app-standard',
        CapacityProviderStrategy: [
          {
            CapacityProvider: 'FARGATE',
            Weight: 1,
          },
        ],
        DesiredCount: 0,
      });
    });

    it('should create task definitions with nginx', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: [
          Match.objectLike({
            Image: 'public.ecr.aws/nginx/nginx:alpine',
            PortMappings: [
              {
                ContainerPort: 80,
                Protocol: 'tcp',
              },
            ],
          }),
        ],
      });
    });
  });

  describe('Network Load Balancer', () => {
    it('should create an NLB', () => {
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Name: 'fargate-spot-sample-nlb',
        Scheme: 'internet-facing',
        Type: 'network',
      });
    });

    it('should create target groups', () => {
      template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 2);
    });

    it('should create TCP listener', () => {
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
        Port: 80,
        Protocol: 'TCP',
      });
    });
  });

  describe('CloudWatch Logs', () => {
    it('should create log group for ECS tasks', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/ecs/fargate-spot-sample-app',
        RetentionInDays: 7,
      });
    });
  });

  describe('Stack Outputs', () => {
    it('should output cluster name', () => {
      template.hasOutput('ClusterName', {
        Value: 'fargate-spot-cluster',
      });
    });

    it('should output DynamoDB table name', () => {
      template.hasOutput('ErrorCounterTableName', {
        Value: 'fargate-spot-error-counter',
      });
    });

    it('should output SNS topic ARN', () => {
      template.hasOutput('NotificationTopicArn', {});
    });

    it('should output NLB DNS', () => {
      template.hasOutput('LoadBalancerDNS', {});
    });
  });

  describe('Configuration Options', () => {
    it('should allow disabling sample app', () => {
      const testApp = new App();
      const testStack = new EcsFargateSpotFailoverStack(testApp, 'TestStackNoApp', {
        createSampleApp: false,
      });
      const testTemplate = Template.fromStack(testStack);

      // Should not have ECS services
      testTemplate.resourceCountIs('AWS::ECS::Service', 0);
      
      // Should not have NLB
      testTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
    });

    it('should allow custom desired count', () => {
      const testApp = new App();
      const testStack = new EcsFargateSpotFailoverStack(testApp, 'TestStackCustomCount', {
        sampleAppDesiredCount: 4,
      });
      const testTemplate = Template.fromStack(testStack);

      testTemplate.hasResourceProperties('AWS::ECS::Service', {
        ServiceName: 'sample-app',
        DesiredCount: 4,
      });
    });

    it('should allow custom app port', () => {
      const testApp = new App();
      const testStack = new EcsFargateSpotFailoverStack(testApp, 'TestStackCustomPort', {
        appPort: 8080,
      });
      const testTemplate = Template.fromStack(testStack);

      testTemplate.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: [
          Match.objectLike({
            PortMappings: [
              {
                ContainerPort: 8080,
              },
            ],
          }),
        ],
      });
    });
  });
});
