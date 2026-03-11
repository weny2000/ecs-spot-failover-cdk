import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { RegionConfig } from './config/regions';

export interface EcsFargateSpotFailoverStackProps extends cdk.StackProps {
  /**
   * Sample application desired count
   * @default 2
   */
  sampleAppDesiredCount?: number;

  /**
   * Whether to create sample application
   * @default true
   */
  createSampleApp?: boolean;

  /**
   * Application port
   * @default 80
   */
  appPort?: number;

  /**
   * DynamoDB TTL days for old records
   * @default 30
   */
  dynamoDbTtlDays?: number;

  /**
   * Region configuration for multi-region deployment
   */
  regionConfig?: RegionConfig;

  /**
   * Whether this is a cross-region deployment
   * @default false
   */
  isCrossRegion?: boolean;

  /**
   * Primary region for replication (for DR regions)
   */
  primaryRegion?: string;

  /**
   * Enable DynamoDB Global Tables for cross-region replication
   * @default false
   */
  enableGlobalTables?: boolean;
}

export class EcsFargateSpotFailoverStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly spotService: ecs.FargateService;
  public readonly standardService: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly notificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props?: EcsFargateSpotFailoverStackProps) {
    super(scope, id, props);

    const sampleAppDesiredCount = props?.sampleAppDesiredCount ?? 2;
    const createSampleApp = props?.createSampleApp ?? true;
    const appPort = props?.appPort ?? 80;
    const dynamoDbTtlDays = props?.dynamoDbTtlDays ?? 30;

    // ==========================================
    // VPC
    // ==========================================
    const vpc = new ec2.Vpc(this, 'FargateSpotVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // ==========================================
    // ECS Cluster with Capacity Providers
    // ==========================================
    const cluster = new ecs.Cluster(this, 'FargateSpotCluster', {
      vpc,
      clusterName: 'fargate-spot-cluster',
    });

    // Enable Fargate and Fargate Spot capacity providers
    cluster.addDefaultCapacityProviderStrategy([
      {
        capacityProvider: 'FARGATE',
        weight: 1,
        base: 0,
      },
      {
        capacityProvider: 'FARGATE_SPOT',
        weight: 3,
        base: 0,
      },
    ]);

    // ==========================================
    // DynamoDB Table with TTL
    // ==========================================
    const errorCounterTable = new dynamodb.Table(this, 'ErrorCounterTable', {
      tableName: 'fargate-spot-error-counter',
      partitionKey: { name: 'service_name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl', // Enable TTL with attribute name 'ttl'
    });

    // Add local secondary index for querying by last error time
    errorCounterTable.addLocalSecondaryIndex({
      indexName: 'last-error-time-index',
      sortKey: { name: 'last_error_time', type: dynamodb.AttributeType.STRING },
    });

    // ==========================================
    // SNS Topic
    // ==========================================
    const notificationTopic = new sns.Topic(this, 'FailoverNotificationTopic', {
      topicName: 'fargate-spot-failover-notifications',
    });
    this.notificationTopic = notificationTopic;

    // ==========================================
    // Lambda Execution Role
    // ==========================================
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
        CloudWatchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cloudwatch:PutMetricData',
                'cloudwatch:GetMetricData',
                'cloudwatch:ListMetrics',
              ],
              resources: ['*'],
            }),
          ],
        }),
        StepFunctionsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'states:StartExecution',
                'states:DescribeExecution',
              ],
              resources: ['*'],
            }),
          ],
        }),
        XRayAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
                'xray:GetSamplingRules',
                'xray:GetSamplingTargets',
                'xray:GetSamplingStatisticSummaries',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // ==========================================
    // Step Functions State Machines
    // ==========================================
    
    // Failover Workflow State Machine
    const failoverStateMachine = new sfn.StateMachine(this, 'FailoverStateMachine', {
      stateMachineName: 'ecs-spot-failover-workflow',
      definitionBody: sfn.DefinitionBody.fromFile('src/step-functions/failover-workflow.asl.json'),
      timeout: cdk.Duration.minutes(10),
      tracingEnabled: true,
      role: new iam.Role(this, 'FailoverStateMachineRole', {
        assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaRole'),
        ],
        inlinePolicies: {
          ECSAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'ecs:UpdateService',
                  'ecs:DescribeServices',
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
                  'dynamodb:UpdateItem',
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
          XRayAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'xray:PutTraceSegments',
                  'xray:PutTelemetryRecords',
                  'xray:GetSamplingRules',
                  'xray:GetSamplingTargets',
                ],
                resources: ['*'],
              }),
            ],
          }),
        },
      }),
    });

    // Cleanup Workflow State Machine
    const cleanupStateMachine = new sfn.StateMachine(this, 'CleanupStateMachine', {
      stateMachineName: 'ecs-spot-cleanup-workflow',
      definitionBody: sfn.DefinitionBody.fromFile('src/step-functions/cleanup-workflow.asl.json'),
      timeout: cdk.Duration.minutes(10),
      tracingEnabled: true,
      role: new iam.Role(this, 'CleanupStateMachineRole', {
        assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaRole'),
        ],
        inlinePolicies: {
          ECSAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'ecs:UpdateService',
                  'ecs:DescribeServices',
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
                  'dynamodb:UpdateItem',
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
          XRayAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'xray:PutTraceSegments',
                  'xray:PutTelemetryRecords',
                  'xray:GetSamplingRules',
                  'xray:GetSamplingTargets',
                ],
                resources: ['*'],
              }),
            ],
          }),
        },
      }),
    });

    // ==========================================
    // Lambda Functions
    // ==========================================

    // Lambda function: Spot error detector
    const spotErrorDetector = new lambda.Function(this, 'SpotErrorDetector', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'spot-error-detector.handler',
      code: lambda.Code.fromAsset('lib/lambda'),
      role: lambdaExecutionRole,
      environment: {
        ERROR_COUNTER_TABLE: errorCounterTable.tableName,
        NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        FAILURE_THRESHOLD: '3',
        FAILOVER_STATE_MACHINE_ARN: failoverStateMachine.stateMachineArn,
        CLOUDWATCH_NAMESPACE: 'ECS/FargateSpotFailover',
        AWS_XRAY_TRACING_NAME: 'SpotErrorDetector',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Lambda function: Spot success monitor
    const spotSuccessMonitor = new lambda.Function(this, 'SpotSuccessMonitor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'spot-success-monitor.handler',
      code: lambda.Code.fromAsset('lib/lambda'),
      role: lambdaExecutionRole,
      environment: {
        ERROR_COUNTER_TABLE: errorCounterTable.tableName,
        NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        CLUSTER_NAME: cluster.clusterName,
        CLEANUP_STATE_MACHINE_ARN: cleanupStateMachine.stateMachineArn,
        CLOUDWATCH_NAMESPACE: 'ECS/FargateSpotFailover',
        AWS_XRAY_TRACING_NAME: 'SpotSuccessMonitor',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Lambda function: PENDING task monitor (proactive monitoring)
    const pendingTaskMonitor = new lambda.Function(this, 'PendingTaskMonitor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'pending-task-monitor.handler',
      code: lambda.Code.fromAsset('lib/lambda'),
      role: lambdaExecutionRole,
      environment: {
        ERROR_COUNTER_TABLE: errorCounterTable.tableName,
        NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        CLUSTER_NAME: cluster.clusterName,
        SPOT_SERVICE_NAME: createSampleApp ? this.spotService!.serviceName : 'sample-app',
        FAILOVER_STATE_MACHINE_ARN: failoverStateMachine.stateMachineArn,
        CLOUDWATCH_NAMESPACE: 'ECS/FargateSpotFailover',
        PENDING_TASK_TIMEOUT_MINUTES: '5',
        FAILURE_THRESHOLD: '3',
        AWS_XRAY_TRACING_NAME: 'PendingTaskMonitor',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      description: 'Monitors ECS tasks stuck in PENDING state to detect Spot capacity issues proactively',
    });

    // ==========================================
    // EventBridge Rules
    // ==========================================
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
            { prefix: 'Resource' },
            { prefix: 'SpotInterruption' },
            { prefix: 'Spot' },
            { prefix: 'capacity' },
            { prefix: 'Capacity' },
            { prefix: 'insufficient' },
            { prefix: 'Insufficient' },
          ],
        },
      },
    });

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

    // EventBridge scheduled rule for PENDING task monitoring (every 1 minute)
    const pendingTaskCheckRule = new events.Rule(this, 'PendingTaskCheckRule', {
      ruleName: 'ecs-spot-pending-check',
      description: 'Periodically check for ECS tasks stuck in PENDING state',
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
    });
    pendingTaskCheckRule.addTarget(new targets.LambdaFunction(pendingTaskMonitor));

    // ==========================================
    // CloudWatch Dashboard
    // ==========================================
    const dashboard = new cloudwatch.Dashboard(this, 'FailoverDashboard', {
      dashboardName: 'ECS-FargateSpot-Failover',
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Spot Error Count',
        left: [
          new cloudwatch.Metric({
            namespace: 'ECS/FargateSpotFailover',
            metricName: 'SpotErrorCount',
            dimensionsMap: {},
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Failover Events',
        left: [
          new cloudwatch.Metric({
            namespace: 'ECS/FargateSpotFailover',
            metricName: 'FailoverTriggered',
            dimensionsMap: {},
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
          new cloudwatch.Metric({
            namespace: 'ECS/FargateSpotFailover',
            metricName: 'RecoveryTriggered',
            dimensionsMap: {},
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Processing Latency',
        left: [
          new cloudwatch.Metric({
            namespace: 'ECS/FargateSpotFailover',
            metricName: 'ProcessingLatency',
            dimensionsMap: { Function: 'SpotErrorDetector' },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
          new cloudwatch.Metric({
            namespace: 'ECS/FargateSpotFailover',
            metricName: 'ProcessingLatency',
            dimensionsMap: { Function: 'SpotSuccessMonitor' },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Function Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'ECS/FargateSpotFailover',
            metricName: 'FunctionError',
            dimensionsMap: {},
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
      })
    );

    // ==========================================
    // CloudWatch Alarms
    // ==========================================
    new cloudwatch.Alarm(this, 'HighErrorRateAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'ECS/FargateSpotFailover',
        metricName: 'FunctionError',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Alarm when error count exceeds threshold',
    }).addAlarmAction(new cloudwatchActions.SnsAction(notificationTopic));

    // ==========================================
    // Sample Application (Optional)
    // ==========================================
    if (createSampleApp) {
      // Application Load Balancer
      const alb = new elbv2.ApplicationLoadBalancer(this, 'SampleAppALB', {
        vpc,
        internetFacing: true,
        loadBalancerName: 'fargate-spot-sample-alb',
      });
      this.loadBalancer = alb;

      // ALB Security Group
      const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
        vpc,
        description: 'Security group for ALB',
        allowAllOutbound: true,
      });
      albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(appPort), 'Allow HTTP traffic');
      alb.addSecurityGroup(albSecurityGroup);

      // Task Role for ECS Tasks
      const taskRole = new iam.Role(this, 'ECSTaskRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        ],
      });

      // Log Group for ECS Tasks
      const logGroup = new logs.LogGroup(this, 'SampleAppLogGroup', {
        logGroupName: '/ecs/fargate-spot-sample-app',
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      // Task Definition for Spot Service (Fargate Spot)
      const spotTaskDef = new ecs.FargateTaskDefinition(this, 'SpotTaskDef', {
        cpu: 256,
        memoryLimitMiB: 512,
        taskRole: taskRole,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });

      spotTaskDef.addContainer('SampleAppContainer', {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:alpine'),
        essential: true,
        portMappings: [
          {
            containerPort: appPort,
            protocol: ecs.Protocol.TCP,
          },
        ],
        logging: ecs.LogDriver.awsLogs({
          streamPrefix: 'spot-service',
          logGroup: logGroup,
        }),
        healthCheck: {
          command: ['CMD-SHELL', `curl -f http://localhost:${appPort}/ || exit 1`],
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
          startPeriod: cdk.Duration.seconds(60),
        },
      });

      // Task Definition for Standard Service (Fargate)
      const standardTaskDef = new ecs.FargateTaskDefinition(this, 'StandardTaskDef', {
        cpu: 256,
        memoryLimitMiB: 512,
        taskRole: taskRole,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });

      standardTaskDef.addContainer('SampleAppContainer', {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:alpine'),
        essential: true,
        portMappings: [
          {
            containerPort: appPort,
            protocol: ecs.Protocol.TCP,
          },
        ],
        logging: ecs.LogDriver.awsLogs({
          streamPrefix: 'standard-service',
          logGroup: logGroup,
        }),
        healthCheck: {
          command: ['CMD-SHELL', `curl -f http://localhost:${appPort}/ || exit 1`],
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
          startPeriod: cdk.Duration.seconds(60),
        },
      });

      // Security Group for ECS Services
      const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
        vpc,
        description: 'Security group for ECS services',
        allowAllOutbound: true,
      });
      serviceSecurityGroup.addIngressRule(
        ec2.Peer.securityGroupId(alb.connections.securityGroups[0].securityGroupId),
        ec2.Port.tcp(appPort),
        'Allow traffic from ALB'
      );

      // Fargate Spot Service
      const spotService = new ecs.FargateService(this, 'SpotService', {
        cluster,
        serviceName: 'sample-app',
        taskDefinition: spotTaskDef,
        desiredCount: sampleAppDesiredCount,
        capacityProviderStrategies: [
          {
            capacityProvider: 'FARGATE_SPOT',
            weight: 1,
            base: 0,
          },
        ],
        securityGroups: [serviceSecurityGroup],
        assignPublicIp: false,
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        circuitBreaker: {
          rollback: true,
        },
        deploymentController: {
          type: ecs.DeploymentControllerType.ECS,
        },
      });
      this.spotService = spotService;

      // Standard Fargate Service (Initially 0 replicas)
      const standardService = new ecs.FargateService(this, 'StandardService', {
        cluster,
        serviceName: 'sample-app-standard',
        taskDefinition: standardTaskDef,
        desiredCount: 0, // Initial 0, started on failover
        capacityProviderStrategies: [
          {
            capacityProvider: 'FARGATE',
            weight: 1,
            base: 0,
          },
        ],
        securityGroups: [serviceSecurityGroup],
        assignPublicIp: false,
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        circuitBreaker: {
          rollback: true,
        },
        deploymentController: {
          type: ecs.DeploymentControllerType.ECS,
        },
      });
      this.standardService = standardService;

      // ALB Target Groups
      const spotTargetGroup = new elbv2.ApplicationTargetGroup(this, 'SpotTargetGroup', {
        vpc,
        port: appPort,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        healthCheck: {
          path: '/',
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
      });

      const standardTargetGroup = new elbv2.ApplicationTargetGroup(this, 'StandardTargetGroup', {
        vpc,
        port: appPort,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        healthCheck: {
          path: '/',
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
      });

      // Attach services to target groups
      spotTargetGroup.addTarget(spotService);
      standardTargetGroup.addTarget(standardService);

      // ALB Listener
      const listener = alb.addListener('HTTPListener', {
        port: appPort,
        open: true,
        defaultTargetGroups: [spotTargetGroup],
      });

      // Output ALB DNS
      new cdk.CfnOutput(this, 'LoadBalancerDNS', {
        value: alb.loadBalancerDnsName,
        description: 'Application Load Balancer DNS Name',
      });

      // Output Service Names
      new cdk.CfnOutput(this, 'SpotServiceName', {
        value: spotService.serviceName,
        description: 'Spot Fargate Service Name',
      });

      new cdk.CfnOutput(this, 'StandardServiceName', {
        value: standardService.serviceName,
        description: 'Standard Fargate Service Name',
      });
    }

    // ==========================================
    // Outputs
    // ==========================================
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

    new cdk.CfnOutput(this, 'CloudWatchDashboard', {
      value: dashboard.dashboardName,
      description: 'CloudWatch Dashboard Name',
    });

    new cdk.CfnOutput(this, 'FailoverStateMachineArn', {
      value: failoverStateMachine.stateMachineArn,
      description: 'Step Functions Failover State Machine ARN',
    });

    new cdk.CfnOutput(this, 'CleanupStateMachineArn', {
      value: cleanupStateMachine.stateMachineArn,
      description: 'Step Functions Cleanup State Machine ARN',
    });

    new cdk.CfnOutput(this, 'XRayServiceMap', {
      value: `https://${this.region}.console.aws.amazon.com/xray/home?region=${this.region}#/service-map`,
      description: 'X-Ray Service Map URL',
    });

    new cdk.CfnOutput(this, 'SpotErrorDetectorFunctionName', {
      value: spotErrorDetector.functionName,
      description: 'Spot Error Detector Lambda Function Name',
    });

    new cdk.CfnOutput(this, 'SpotSuccessMonitorFunctionName', {
      value: spotSuccessMonitor.functionName,
      description: 'Spot Success Monitor Lambda Function Name',
    });
  }
}
