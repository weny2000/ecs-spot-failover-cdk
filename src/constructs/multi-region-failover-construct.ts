/**
 * Multi-Region Failover Construct
 * 
 * This construct provides automatic cross-region failover capabilities:
 * - Route53 DNS failover with health checks
 * - DynamoDB Global Tables for state synchronization
 * - Lambda-based region health monitoring
 * - Automatic traffic routing to healthy regions
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as nlb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export interface MultiRegionFailoverProps {
  /**
   * Primary region
   */
  readonly primaryRegion: string;

  /**
   * Secondary/DR regions
   */
  readonly secondaryRegions: string[];

  /**
   * Route53 Hosted Zone ID for DNS failover
   */
  readonly hostedZoneId?: string;

  /**
   * DNS record name (e.g., app.example.com)
   */
  readonly dnsRecordName?: string;

  /**
   * Whether to enable DynamoDB Global Tables
   * @default true
   */
  readonly enableGlobalTables?: boolean;

  /**
   * Health check interval in seconds
   * @default 30
   */
  readonly healthCheckInterval?: number;

  /**
   * Failover threshold (consecutive failures before failover)
   * @default 3
   */
  readonly failoverThreshold?: number;

  /**
   * Recovery threshold (consecutive successes before failback)
   * @default 2
   */
  readonly recoveryThreshold?: number;

  /**
   * SNS topic for notifications
   */
  readonly notificationTopic?: sns.ITopic;

  /**
   * Reference to NLBs in each region
   */
  readonly regionLoadBalancers?: Record<string, nlb.INetworkLoadBalancer>;
}

export class MultiRegionFailoverConstruct extends Construct {
  /**
   * DynamoDB table for health checks (Global Table)
   */
  public readonly healthCheckTable: dynamodb.Table;

  /**
   * DynamoDB table for global failover state (Global Table)
   */
  public readonly globalStateTable: dynamodb.Table;

  /**
   * Lambda function for region health monitoring
   */
  public readonly regionHealthMonitor: lambda.Function;

  /**
   * Route53 health checks for each region
   */
  public readonly route53HealthChecks: Record<string, route53.CfnHealthCheck> = {};

  constructor(scope: Construct, id: string, props: MultiRegionFailoverProps) {
    super(scope, id);

    const {
      primaryRegion,
      secondaryRegions,
      hostedZoneId,
      dnsRecordName,
      enableGlobalTables = true,
      healthCheckInterval = 30,
      failoverThreshold = 3,
      recoveryThreshold = 2,
      notificationTopic,
      regionLoadBalancers = {},
    } = props;

    const allRegions = [primaryRegion, ...secondaryRegions];

    // ==========================================
    // DynamoDB Global Tables
    // ==========================================

    // Health check table - Global Table
    this.healthCheckTable = new dynamodb.Table(this, 'HealthCheckTable', {
      tableName: 'region-health-checks',
      partitionKey: { name: 'region', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    if (enableGlobalTables) {
      // Create replicas in all secondary regions
      secondaryRegions.forEach(region => {
        new dynamodb.CfnGlobalTable(this, `HealthCheckGlobalTable-${region}`, {
          tableName: this.healthCheckTable.tableName,
          attributeDefinitions: [
            { attributeName: 'region', attributeType: 'S' },
            { attributeName: 'timestamp', attributeType: 'S' },
          ],
          keySchema: [
            { attributeName: 'region', keyType: 'HASH' },
            { attributeName: 'timestamp', keyType: 'RANGE' },
          ],
          billingMode: 'PAY_PER_REQUEST',
          replicas: [
            { region: primaryRegion },
            ...secondaryRegions.map(r => ({ region: r })),
          ],
        });
      });
    }

    // Global state table - Global Table
    this.globalStateTable = new dynamodb.Table(this, 'GlobalStateTable', {
      tableName: 'global-failover-state',
      partitionKey: { name: 'stateId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    if (enableGlobalTables) {
      new dynamodb.CfnGlobalTable(this, 'GlobalStateGlobalTable', {
        tableName: this.globalStateTable.tableName,
        attributeDefinitions: [
          { attributeName: 'stateId', attributeType: 'S' },
        ],
        keySchema: [
          { attributeName: 'stateId', keyType: 'HASH' },
        ],
        billingMode: 'PAY_PER_REQUEST',
        replicas: [
          { region: primaryRegion },
          ...secondaryRegions.map(r => ({ region: r })),
        ],
      });
    }

    // ==========================================
    // Route53 Health Checks
    // ==========================================

    if (hostedZoneId && dnsRecordName) {
      allRegions.forEach((region, index) => {
        const nlb = regionLoadBalancers[region];
        if (nlb) {
          // Create health check for each region's NLB
          this.route53HealthChecks[region] = new route53.CfnHealthCheck(this, `HealthCheck-${region}`, {
            healthCheckConfig: {
              type: 'HTTP',
              resourcePath: '/health',
              fullyQualifiedDomainName: nlb.loadBalancerDnsName,
              port: 80,
              requestInterval: healthCheckInterval,
              failureThreshold: failoverThreshold,
              measureLatency: true,
              regions: ['us-east-1', 'us-west-2', 'us-west-1', 'eu-west-1', 'ap-southeast-1'],
            },
            healthCheckTags: [
              { key: 'Name', value: `${region}-health-check` },
              { key: 'Region', value: region },
              { key: 'Type', value: region === primaryRegion ? 'primary' : 'secondary' },
            ],
          });
        }
      });
    }

    // ==========================================
    // Lambda - Region Health Monitor
    // ==========================================

    const lambdaExecutionRole = new iam.Role(this, 'HealthMonitorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [
                this.healthCheckTable.tableArn,
                this.globalStateTable.tableArn,
              ],
            }),
          ],
        }),
        CloudWatchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cloudwatch:GetMetricStatistics',
                'cloudwatch:PutMetricData',
                'cloudwatch:ListMetrics',
              ],
              resources: ['*'],
            }),
          ],
        }),
        ECSAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ecs:DescribeServices',
                'ecs:DescribeClusters',
                'ecs:ListServices',
              ],
              resources: ['*'],
            }),
          ],
        }),
        Route53Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'route53:ChangeResourceRecordSets',
                'route53:GetHealthCheckStatus',
                'route53:ListHealthChecks',
              ],
              resources: ['*'],
            }),
          ],
        }),
        SNSAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sns:Publish'],
              resources: notificationTopic ? [notificationTopic.topicArn] : ['*'],
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
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    this.regionHealthMonitor = new lambda.Function(this, 'RegionHealthMonitor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'region-health-monitor.handler',
      code: lambda.Code.fromAsset('lib/lambda'),
      role: lambdaExecutionRole,
      environment: {
        HEALTH_CHECK_TABLE: this.healthCheckTable.tableName,
        GLOBAL_STATE_TABLE: this.globalStateTable.tableName,
        NOTIFICATION_TOPIC_ARN: notificationTopic?.topicArn || '',
        ROUTE53_HOSTED_ZONE_ID: hostedZoneId || '',
        DNS_RECORD_NAME: dnsRecordName || '',
        PRIMARY_REGION: primaryRegion,
        SECONDARY_REGIONS: secondaryRegions.join(','),
        FAILOVER_THRESHOLD: failoverThreshold.toString(),
        RECOVERY_THRESHOLD: recoveryThreshold.toString(),
        HEALTH_CHECK_INTERVAL: healthCheckInterval.toString(),
        AWS_XRAY_TRACING_NAME: 'RegionHealthMonitor',
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      tracing: lambda.Tracing.ACTIVE,
      description: 'Multi-region health monitor with automatic DNS failover',
    });

    // ==========================================
    // EventBridge - Scheduled Health Checks
    // ==========================================

    new events.Rule(this, 'HealthCheckSchedule', {
      ruleName: 'multi-region-health-check',
      description: `Monitor health of all regions every ${healthCheckInterval} seconds`,
      schedule: events.Schedule.rate(cdk.Duration.seconds(healthCheckInterval)),
      targets: [new targets.LambdaFunction(this.regionHealthMonitor)],
    });

    // ==========================================
    // CloudWatch Alarms
    // ==========================================

    // Alarm for primary region failure
    new cloudwatch.Alarm(this, 'PrimaryRegionFailureAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'MultiRegion/Failover',
        metricName: 'PrimaryRegionHealth',
        dimensionsMap: { Region: primaryRegion },
        statistic: 'Minimum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: `Primary region ${primaryRegion} health check failed`,
    });

    // Alarm for failover events
    new cloudwatch.Alarm(this, 'FailoverEventAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'MultiRegion/Failover',
        metricName: 'FailoverCount',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Multi-region failover event detected',
    });

    // ==========================================
    // Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'HealthCheckTable', {
      value: this.healthCheckTable.tableName,
      description: 'DynamoDB Health Check Table',
    });

    new cdk.CfnOutput(this, 'GlobalStateTable', {
      value: this.globalStateTable.tableName,
      description: 'DynamoDB Global State Table',
    });

    new cdk.CfnOutput(this, 'HealthMonitorFunction', {
      value: this.regionHealthMonitor.functionName,
      description: 'Region Health Monitor Lambda',
    });

    new cdk.CfnOutput(this, 'PrimaryRegion', {
      value: primaryRegion,
      description: 'Primary Region',
    });

    new cdk.CfnOutput(this, 'SecondaryRegions', {
      value: secondaryRegions.join(', '),
      description: 'Secondary/DR Regions',
    });
  }
}
