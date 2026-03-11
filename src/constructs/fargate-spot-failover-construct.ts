/**
 * FargateSpotFailoverConstruct - Reusable CDK Construct
 * 
 * A production-ready CDK construct that provides automatic failover
 * from Fargate Spot to Standard Fargate when consecutive failures occur.
 * 
 * This construct can be integrated into existing ECS deployments.
 */

import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

/**
 * Properties for FargateSpotFailoverConstruct
 */
export interface FargateSpotFailoverProps {
  /**
   * The ECS cluster containing the services
   */
  readonly cluster: ecs.Cluster;

  /**
   * The Fargate Spot service to monitor
   */
  readonly spotService: ecs.FargateService;

  /**
   * The Standard Fargate service for failover
   */
  readonly standardService: ecs.FargateService;

  /**
   * Number of consecutive failures before triggering failover
   * @default 3
   */
  readonly failureThreshold?: number;

  /**
   * Whether to enable SNS notifications
   * @default true
   */
  readonly enableNotifications?: boolean;

  /**
   * Email addresses for notifications (if enableNotifications is true)
   */
  readonly notificationEmails?: string[];

  /**
   * DynamoDB TTL days for error counter records
   * @default 30
   */
  readonly dynamoDbTtlDays?: number;

  /**
   * CloudWatch namespace for custom metrics
   * @default 'ECS/FargateSpotFailover'
   */
  readonly cloudWatchNamespace?: string;

  /**
   * Enable X-Ray tracing
   * @default true
   */
  readonly enableTracing?: boolean;

  /**
   * Lambda memory size (MB)
   * @default 256
   */
  readonly lambdaMemorySize?: number;

  /**
   * Lambda timeout
   * @default cdk.Duration.seconds(30)
   */
  readonly lambdaTimeout?: cdk.Duration;

  /**
   * Enable PENDING task monitoring (detects tasks stuck in PENDING state)
   * @default true
   */
  readonly enablePendingTaskMonitoring?: boolean;

  /**
   * PENDING task check interval
   * @default cdk.Duration.minutes(1)
   */
  readonly pendingTaskCheckInterval?: cdk.Duration;

  /**
   * PENDING task timeout threshold (how long a task can be in PENDING before considered failed)
   * @default cdk.Duration.minutes(5)
   */
  readonly pendingTaskTimeout?: cdk.Duration;
}

/**
 * FargateSpotFailoverConstruct - Automatic failover from Spot to Standard Fargate
 * 
 * @example
 * ```typescript
 * const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
 * 
 * const spotService = new ecs.FargateService(this, 'SpotService', {
 *   cluster,
 *   taskDefinition: spotTaskDef,
 *   capacityProviderStrategies: [{ capacityProvider: 'FARGATE_SPOT', weight: 1 }],
 * });
 * 
 * const standardService = new ecs.FargateService(this, 'StandardService', {
 *   cluster,
 *   taskDefinition: standardTaskDef,
 *   capacityProviderStrategies: [{ capacityProvider: 'FARGATE', weight: 1 }],
 *   desiredCount: 0, // Initially 0
 * });
 * 
 * new FargateSpotFailoverConstruct(this, 'Failover', {
 *   cluster,
 *   spotService,
 *   standardService,
 *   failureThreshold: 3,
 * });
 * ```
 */
export class FargateSpotFailoverConstruct extends Construct {
  /**
   * DynamoDB table for error counter
   */
  public readonly errorCounterTable: dynamodb.Table;

  /**
   * SNS topic for notifications
   */
  public readonly notificationTopic?: sns.Topic;

  /**
   * Lambda function for error detection
   */
  public readonly spotErrorDetector: lambda.Function;

  /**
   * Lambda function for success monitoring
   */
  public readonly spotSuccessMonitor: lambda.Function;

  /**
   * Lambda function for PENDING task monitoring
   */
  public readonly pendingTaskMonitor?: lambda.Function;

  /**
   * Step Functions state machine for failover workflow
   */
  public readonly failoverStateMachine: sfn.StateMachine;

  /**
   * Step Functions state machine for cleanup workflow
   */
  public readonly cleanupStateMachine: sfn.StateMachine;

  /**
   * CloudWatch dashboard
   */
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: FargateSpotFailoverProps) {
    super(scope, id);

    const {
      cluster,
      spotService,
      standardService,
      failureThreshold = 3,
      enableNotifications = true,
      notificationEmails = [],
      dynamoDbTtlDays = 30,
      cloudWatchNamespace = 'ECS/FargateSpotFailover',
      enableTracing = true,
      lambdaMemorySize = 256,
      lambdaTimeout = cdk.Duration.seconds(30),
      enablePendingTaskMonitoring = true,
      pendingTaskCheckInterval = cdk.Duration.minutes(1),
      pendingTaskTimeout = cdk.Duration.minutes(5),
    } = props;

    // ==========================================
    // DynamoDB Table with TTL
    // ==========================================
    this.errorCounterTable = new dynamodb.Table(this, 'ErrorCounterTable', {
      tableName: `fargate-spot-error-counter-${id.toLowerCase()}`,
      partitionKey: { name: 'service_name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // Add local secondary index for querying by last error time
    this.errorCounterTable.addLocalSecondaryIndex({
      indexName: 'last-error-time-index',
      sortKey: { name: 'last_error_time', type: dynamodb.AttributeType.STRING },
    });

    // ==========================================
    // SNS Topic
    // ==========================================
    if (enableNotifications) {
      this.notificationTopic = new sns.Topic(this, 'NotificationTopic', {
        topicName: `fargate-spot-failover-${id.toLowerCase()}`,
      });

      // Add email subscriptions
      notificationEmails.forEach((email, index) => {
        this.notificationTopic!.addSubscription(
          new snsSubscriptions.EmailSubscription(email, {
            json: false,
          })
        );
      });
    }

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
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [
                this.errorCounterTable.tableArn,
                `${this.errorCounterTable.tableArn}/index/*`,
              ],
            }),
          ],
        }),
        ...(this.notificationTopic ? {
          SNSAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['sns:Publish'],
                resources: [this.notificationTopic.topicArn],
              }),
            ],
          }),
        } : {}),
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
    this.failoverStateMachine = new sfn.StateMachine(this, 'FailoverStateMachine', {
      stateMachineName: `ecs-spot-failover-${id.toLowerCase()}`,
      definition: this.createFailoverWorkflow(spotService, standardService, lambdaExecutionRole),
      timeout: cdk.Duration.minutes(10),
      tracingEnabled: enableTracing,
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
                resources: [this.errorCounterTable.tableArn],
              }),
            ],
          }),
          ...(this.notificationTopic ? {
            SNSAccess: new iam.PolicyDocument({
              statements: [
                new iam.PolicyStatement({
                  effect: iam.Effect.ALLOW,
                  actions: ['sns:Publish'],
                  resources: [this.notificationTopic.topicArn],
                }),
              ],
            }),
          } : {}),
        },
      }),
    });

    // Cleanup Workflow State Machine
    this.cleanupStateMachine = new sfn.StateMachine(this, 'CleanupStateMachine', {
      stateMachineName: `ecs-spot-cleanup-${id.toLowerCase()}`,
      definition: this.createCleanupWorkflow(spotService, standardService, lambdaExecutionRole),
      timeout: cdk.Duration.minutes(10),
      tracingEnabled: enableTracing,
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
                resources: [this.errorCounterTable.tableArn],
              }),
            ],
          }),
          ...(this.notificationTopic ? {
            SNSAccess: new iam.PolicyDocument({
              statements: [
                new iam.PolicyStatement({
                  effect: iam.Effect.ALLOW,
                  actions: ['sns:Publish'],
                  resources: [this.notificationTopic.topicArn],
                }),
              ],
            }),
          } : {}),
        },
      }),
    });

    // ==========================================
    // Lambda Functions
    // ==========================================

    // Lambda function: Spot error detector
    this.spotErrorDetector = new lambda.Function(this, 'SpotErrorDetector', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'spot-error-detector.handler',
      code: lambda.Code.fromAsset('lib/lambda'),
      role: lambdaExecutionRole,
      environment: {
        ERROR_COUNTER_TABLE: this.errorCounterTable.tableName,
        NOTIFICATION_TOPIC_ARN: this.notificationTopic?.topicArn || '',
        FAILURE_THRESHOLD: failureThreshold.toString(),
        FAILOVER_STATE_MACHINE_ARN: this.failoverStateMachine.stateMachineArn,
        CLOUDWATCH_NAMESPACE: cloudWatchNamespace,
        AWS_XRAY_TRACING_NAME: 'SpotErrorDetector',
      },
      timeout: lambdaTimeout,
      memorySize: lambdaMemorySize,
      tracing: enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
    });

    // Lambda function: Spot success monitor
    this.spotSuccessMonitor = new lambda.Function(this, 'SpotSuccessMonitor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'spot-success-monitor.handler',
      code: lambda.Code.fromAsset('lib/lambda'),
      role: lambdaExecutionRole,
      environment: {
        ERROR_COUNTER_TABLE: this.errorCounterTable.tableName,
        NOTIFICATION_TOPIC_ARN: this.notificationTopic?.topicArn || '',
        CLUSTER_NAME: cluster.clusterName,
        CLEANUP_STATE_MACHINE_ARN: this.cleanupStateMachine.stateMachineArn,
        CLOUDWATCH_NAMESPACE: cloudWatchNamespace,
        AWS_XRAY_TRACING_NAME: 'SpotSuccessMonitor',
      },
      timeout: lambdaTimeout,
      memorySize: lambdaMemorySize,
      tracing: enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
    });

    // Lambda function: PENDING task monitor
    if (enablePendingTaskMonitoring) {
      this.pendingTaskMonitor = new lambda.Function(this, 'PendingTaskMonitor', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'pending-task-monitor.handler',
        code: lambda.Code.fromAsset('lib/lambda'),
        role: lambdaExecutionRole,
        environment: {
          ERROR_COUNTER_TABLE: this.errorCounterTable.tableName,
          NOTIFICATION_TOPIC_ARN: this.notificationTopic?.topicArn || '',
          CLUSTER_NAME: cluster.clusterName,
          SPOT_SERVICE_NAME: spotService.serviceName,
          FAILOVER_STATE_MACHINE_ARN: this.failoverStateMachine.stateMachineArn,
          CLOUDWATCH_NAMESPACE: cloudWatchNamespace,
          PENDING_TASK_TIMEOUT_MINUTES: pendingTaskTimeout.toMinutes().toString(),
          AWS_XRAY_TRACING_NAME: 'PendingTaskMonitor',
        },
        timeout: lambdaTimeout,
        memorySize: lambdaMemorySize,
        tracing: enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
      });
    }

    // ==========================================
    // EventBridge Rules
    // ==========================================
    
    // Rule for STOPPED events (errors)
    const ecsTaskStateChangeRule = new events.Rule(this, 'EcsTaskStateChangeRule', {
      ruleName: `ecs-spot-error-${id.toLowerCase()}`,
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
    ecsTaskStateChangeRule.addTarget(new targets.LambdaFunction(this.spotErrorDetector));

    // Rule for RUNNING events (success)
    const ecsTaskRunningRule = new events.Rule(this, 'EcsTaskRunningRule', {
      ruleName: `ecs-spot-success-${id.toLowerCase()}`,
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: {
          clusterArn: [cluster.clusterArn],
          lastStatus: ['RUNNING'],
        },
      },
    });
    ecsTaskRunningRule.addTarget(new targets.LambdaFunction(this.spotSuccessMonitor));

    // Rule for PENDING task monitoring (scheduled)
    if (enablePendingTaskMonitoring && this.pendingTaskMonitor) {
      new events.Rule(this, 'PendingTaskCheckRule', {
        ruleName: `ecs-spot-pending-${id.toLowerCase()}`,
        schedule: events.Schedule.rate(pendingTaskCheckInterval),
        targets: [new targets.LambdaFunction(this.pendingTaskMonitor)],
      });
    }

    // ==========================================
    // CloudWatch Dashboard
    // ==========================================
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `ECS-FargateSpot-${id}`,
    });

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Spot Error Count',
        left: [
          new cloudwatch.Metric({
            namespace: cloudWatchNamespace,
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
            namespace: cloudWatchNamespace,
            metricName: 'FailoverTriggered',
            dimensionsMap: {},
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
          new cloudwatch.Metric({
            namespace: cloudWatchNamespace,
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
            namespace: cloudWatchNamespace,
            metricName: 'ProcessingLatency',
            dimensionsMap: { Function: 'SpotErrorDetector' },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
          new cloudwatch.Metric({
            namespace: cloudWatchNamespace,
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
            namespace: cloudWatchNamespace,
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
    const highErrorRateAlarm = new cloudwatch.Alarm(this, 'HighErrorRateAlarm', {
      metric: new cloudwatch.Metric({
        namespace: cloudWatchNamespace,
        metricName: 'FunctionError',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: `High error rate in Fargate Spot Failover - ${id}`,
    });
    
    if (this.notificationTopic) {
      highErrorRateAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.notificationTopic));
    }

    // ==========================================
    // Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'ErrorCounterTableName', {
      value: this.errorCounterTable.tableName,
      description: 'DynamoDB Error Counter Table Name',
    });

    if (this.notificationTopic) {
      new cdk.CfnOutput(this, 'NotificationTopicArn', {
        value: this.notificationTopic.topicArn,
        description: 'SNS Notification Topic ARN',
      });
    }

    new cdk.CfnOutput(this, 'CloudWatchDashboard', {
      value: this.dashboard.dashboardName,
      description: 'CloudWatch Dashboard Name',
    });

    new cdk.CfnOutput(this, 'FailoverStateMachineArn', {
      value: this.failoverStateMachine.stateMachineArn,
      description: 'Step Functions Failover State Machine ARN',
    });

    new cdk.CfnOutput(this, 'CleanupStateMachineArn', {
      value: this.cleanupStateMachine.stateMachineArn,
      description: 'Step Functions Cleanup State Machine ARN',
    });
  }

  /**
   * Create the failover workflow state machine definition
   */
  private createFailoverWorkflow(
    spotService: ecs.FargateService,
    standardService: ecs.FargateService,
    role: iam.IRole
  ): sfn.IChainable {
    const getCurrentState = new sfnTasks.CallAwsService(this, 'GetFailoverState', {
      service: 'dynamodb',
      action: 'getItem',
      parameters: {
        TableName: this.errorCounterTable.tableName,
        Key: {
          service_name: { S: spotService.serviceName },
        },
      },
      iamResources: [this.errorCounterTable.tableArn],
      resultPath: '$.currentState',
    });

    const checkAlreadyFailover = new sfn.Choice(this, 'CheckAlreadyFailover')
      .when(
        sfn.Condition.booleanEquals('$.currentState.Item.failover_state.M.failover_active.BOOL', true),
        new sfn.Succeed(this, 'AlreadyInFailover')
      )
      .otherwise(new sfn.Pass(this, 'ContinueToFailover'));

    const updateFailoverState = new sfnTasks.CallAwsService(this, 'UpdateFailoverState', {
      service: 'dynamodb',
      action: 'updateItem',
      parameters: {
        TableName: this.errorCounterTable.tableName,
        Key: {
          service_name: { S: spotService.serviceName },
        },
        UpdateExpression: 'SET failover_state = :state',
        ExpressionAttributeValues: {
          ':state': {
            M: {
              failover_active: { BOOL: true },
              failover_time: { S: sfn.JsonPath.stringAt('$$.State.EnteredTime') },
              spot_service: { S: spotService.serviceName },
              standard_service: { S: standardService.serviceName },
              original_desired_count: { N: sfn.JsonPath.stringAt('$.originalDesiredCount') },
            },
          },
        },
      },
      iamResources: [this.errorCounterTable.tableArn],
      resultPath: sfn.JsonPath.DISCARD,
    });

    const startStandardService = new sfnTasks.CallAwsService(this, 'StartStandardService', {
      service: 'ecs',
      action: 'updateService',
      parameters: {
        Cluster: spotService.cluster.clusterName,
        Service: standardService.serviceName,
        DesiredCount: sfn.JsonPath.numberAt('$.originalDesiredCount'),
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    const waitForStabilization = new sfn.Wait(this, 'WaitForStabilization', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(30)),
    });

    const stopSpotService = new sfnTasks.CallAwsService(this, 'StopSpotService', {
      service: 'ecs',
      action: 'updateService',
      parameters: {
        Cluster: spotService.cluster.clusterName,
        Service: spotService.serviceName,
        DesiredCount: 0,
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    const notifyFailover = this.notificationTopic
      ? new sfnTasks.SnsPublish(this, 'NotifyFailover', {
          topic: this.notificationTopic,
          message: sfn.TaskInput.fromObject({
            Subject: 'ECS Spot Failover Completed',
            Message: sfn.JsonPath.format(
              'Failover completed for service {} at {}',
              spotService.serviceName,
              sfn.JsonPath.stringAt('$$.State.EnteredTime')
            ),
          }),
          resultPath: sfn.JsonPath.DISCARD,
        })
      : new sfn.Succeed(this, 'NoNotification');

    const definition = getCurrentState
      .next(checkAlreadyFailover)
      
      .next(updateFailoverState)
      .next(startStandardService)
      .next(waitForStabilization)
      .next(stopSpotService)
      .next(notifyFailover);

    return definition;
  }

  /**
   * Create the cleanup workflow state machine definition
   */
  private createCleanupWorkflow(
    spotService: ecs.FargateService,
    standardService: ecs.FargateService,
    role: iam.IRole
  ): sfn.IChainable {
    const updateFailoverState = new sfnTasks.CallAwsService(this, 'ResetFailoverState', {
      service: 'dynamodb',
      action: 'updateItem',
      parameters: {
        TableName: this.errorCounterTable.tableName,
        Key: {
          service_name: { S: spotService.serviceName },
        },
        UpdateExpression: 'SET failover_state = :state, error_count = :zero, cleanup_in_progress = :false',
        ExpressionAttributeValues: {
          ':state': {
            M: {
              failover_active: { BOOL: false },
              recovery_time: { S: sfn.JsonPath.stringAt('$$.State.EnteredTime') },
            },
          },
          ':zero': { N: '0' },
          ':false': { BOOL: false },
        },
      },
      iamResources: [this.errorCounterTable.tableArn],
      resultPath: sfn.JsonPath.DISCARD,
    });

    const startSpotService = new sfnTasks.CallAwsService(this, 'RestartSpotService', {
      service: 'ecs',
      action: 'updateService',
      parameters: {
        Cluster: spotService.cluster.clusterName,
        Service: spotService.serviceName,
        DesiredCount: sfn.JsonPath.numberAt('$.originalDesiredCount'),
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    const waitForSpotStabilization = new sfn.Wait(this, 'WaitForSpotStabilization', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(60)),
    });

    const stopStandardService = new sfnTasks.CallAwsService(this, 'StopStandardService', {
      service: 'ecs',
      action: 'updateService',
      parameters: {
        Cluster: spotService.cluster.clusterName,
        Service: standardService.serviceName,
        DesiredCount: 0,
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    const notifyRecovery = this.notificationTopic
      ? new sfnTasks.SnsPublish(this, 'NotifyRecovery', {
          topic: this.notificationTopic,
          message: sfn.TaskInput.fromObject({
            Subject: 'ECS Spot Recovery Completed',
            Message: sfn.JsonPath.format(
              'Recovery completed for service {} at {}. Switched back to Spot.',
              spotService.serviceName,
              sfn.JsonPath.stringAt('$$.State.EnteredTime')
            ),
          }),
          resultPath: sfn.JsonPath.DISCARD,
        })
      : new sfn.Succeed(this, 'NoRecoveryNotification');

    const definition = updateFailoverState
      .next(startSpotService)
      .next(waitForSpotStabilization)
      .next(stopStandardService)
      .next(notifyRecovery);

    return definition;
  }
}
