import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class EcsFargateSpotFailoverStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'FargateSpotVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'FargateSpotCluster', {
      vpc,
      clusterName: 'fargate-spot-cluster',
    });

    // DynamoDB table for storing error counters
    const errorCounterTable = new dynamodb.Table(this, 'ErrorCounterTable', {
      tableName: 'fargate-spot-error-counter',
      partitionKey: { name: 'service_name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // SNS topic for notifications
    const notificationTopic = new sns.Topic(this, 'FailoverNotificationTopic', {
      topicName: 'fargate-spot-failover-notifications',
    });

    // Lambda execution role
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        ECSAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ecs:UpdateService',
                'ecs:DescribeServices',
                'ecs:DescribeTasks',
                'ecs:ListTasks',
              ],
              resources: ['*'],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
              ],
              resources: [errorCounterTable.tableArn],
            }),
          ],
        }),
        SNSAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sns:Publish'],
              resources: [notificationTopic.topicArn],
            }),
          ],
        }),
      },
    }); 
   // Lambda function: Spot error detector
    const spotErrorDetector = new lambda.Function(this, 'SpotErrorDetector', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'spot-error-detector.handler',
      code: lambda.Code.fromAsset('src/lambda'),
      role: lambdaExecutionRole,
      environment: {
        ERROR_COUNTER_TABLE: errorCounterTable.tableName,
        NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        FAILURE_THRESHOLD: '3',
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Lambda function: Fargate failback orchestrator
    const fargateFailbackOrchestrator = new lambda.Function(this, 'FargateFailbackOrchestrator', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'fargate-failback-orchestrator.handler',
      code: lambda.Code.fromAsset('src/lambda'),
      role: lambdaExecutionRole,
      environment: {
        ERROR_COUNTER_TABLE: errorCounterTable.tableName,
        NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        CLUSTER_NAME: cluster.clusterName,
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Lambda function: Spot success monitor
    const spotSuccessMonitor = new lambda.Function(this, 'SpotSuccessMonitor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'spot-success-monitor.handler',
      code: lambda.Code.fromAsset('src/lambda'),
      role: lambdaExecutionRole,
      environment: {
        ERROR_COUNTER_TABLE: errorCounterTable.tableName,
        NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        CLUSTER_NAME: cluster.clusterName,
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Lambda function: Cleanup orchestrator
    const cleanupOrchestrator = new lambda.Function(this, 'CleanupOrchestrator', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'cleanup-orchestrator.handler',
      code: lambda.Code.fromAsset('src/lambda'),
      role: lambdaExecutionRole,
      environment: {
        ERROR_COUNTER_TABLE: errorCounterTable.tableName,
        NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        CLUSTER_NAME: cluster.clusterName,
      },
      timeout: cdk.Duration.minutes(5),
    });

    // EventBridge rule: Listen for ECS task state changes
    const ecsTaskStateChangeRule = new events.Rule(this, 'EcsTaskStateChangeRule', {
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: {
          clusterArn: [cluster.clusterArn],
          lastStatus: ['STOPPED'],
          stoppedReason: [
            { prefix: 'Task stopped due to' },
            { prefix: 'ResourcesNotAvailable' },
            { prefix: 'SpotInterruption' },
          ],
        },
      },
    });

    // EventBridge rule: Listen for ECS task successful startup
    const ecsTaskRunningRule = new events.Rule(this, 'EcsTaskRunningRule', {
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: {
          clusterArn: [cluster.clusterArn],
          lastStatus: ['RUNNING'],
        },
      },
    });

    // Add Lambda functions as targets for EventBridge rules
    ecsTaskStateChangeRule.addTarget(new targets.LambdaFunction(spotErrorDetector));
    ecsTaskRunningRule.addTarget(new targets.LambdaFunction(spotSuccessMonitor));

    // Output important information
    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS Cluster Name',
    });

    new cdk.CfnOutput(this, 'ErrorCounterTableName', {
      value: errorCounterTable.tableName,
      description: 'DynamoDB Error Counter Table Name',
    });

    new cdk.CfnOutput(this, 'NotificationTopicArn', {
      value: notificationTopic.topicArn,
      description: 'SNS Notification Topic ARN',
    });
  }
}