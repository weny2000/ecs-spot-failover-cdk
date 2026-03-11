/**
 * Multi-Region Failover Stack
 * 
 * This stack deploys the complete multi-region disaster recovery solution:
 * - ECS services in multiple regions (primary + DR)
 * - DynamoDB Global Tables for state synchronization
 * - Route53 DNS failover with health checks
 * - Automatic region health monitoring and failover
 * 
 * Usage:
 *   cdk deploy MultiRegionFailoverStack \
 *     -c primaryRegion=us-east-1 \
 *     -c secondaryRegions=us-west-2,eu-west-1 \
 *     -c hostedZoneId=Z123456789 \
 *     -c dnsRecordName=app.example.com
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as nlb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { EcsFargateSpotFailoverStack, EcsFargateSpotFailoverStackProps } from './ecs-fargate-spot-failover-stack';
import { MultiRegionFailoverConstruct } from './constructs/multi-region-failover-construct';
import { getRegionConfig } from './config/regions';

export interface MultiRegionFailoverStackProps extends cdk.StackProps {
  /**
   * Primary AWS region
   * @default 'us-east-1'
   */
  readonly primaryRegion?: string;

  /**
   * Secondary/DR regions (comma-separated)
   * @default 'us-west-2'
   */
  readonly secondaryRegions?: string;

  /**
   * Route53 Hosted Zone ID for DNS failover
   */
  readonly hostedZoneId?: string;

  /**
   * DNS record name for the application (e.g., app.example.com)
   */
  readonly dnsRecordName?: string;

  /**
   * Sample application desired count in primary region
   * @default 2
   */
  readonly primaryDesiredCount?: number;

  /**
   * Sample application desired count in secondary regions
   * @default 0 (cold standby)
   */
  readonly secondaryDesiredCount?: number;

  /**
   * Application port
   * @default 80
   */
  readonly appPort?: number;

  /**
   * Sample application image
   * @default 'public.ecr.aws/nginx/nginx:alpine'
   */
  readonly sampleAppImage?: string;

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
   * Failover threshold (consecutive failures)
   * @default 3
   */
  readonly failoverThreshold?: number;

  /**
   * Recovery threshold (consecutive successes)
   * @default 2
   */
  readonly recoveryThreshold?: number;

  /**
   * Whether to use warm standby in secondary regions
   * (if false, secondary regions start with 0 tasks - cold standby)
   * @default false
   */
  readonly warmStandby?: boolean;
}

/**
 * Multi-Region Failover Stack
 * 
 * Deploys a complete disaster recovery solution with automatic cross-region failover.
 * 
 * @example
 * ```typescript
 * new MultiRegionFailoverStack(app, 'MultiRegionStack', {
 *   primaryRegion: 'us-east-1',
 *   secondaryRegions: 'us-west-2,eu-west-1',
 *   hostedZoneId: 'Z123456789',
 *   dnsRecordName: 'app.example.com',
 *   warmStandby: true,
 * });
 * ```
 */
export class MultiRegionFailoverStack extends cdk.Stack {
  /**
   * Primary region stack
   */
  public readonly primaryStack: EcsFargateSpotFailoverStack;

  /**
   * Secondary region stacks
   */
  public readonly secondaryStacks: EcsFargateSpotFailoverStack[] = [];

  /**
   * Multi-region failover construct
   */
  public readonly multiRegionFailover: MultiRegionFailoverConstruct;

  /**
   * SNS topic for notifications
   */
  public readonly notificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MultiRegionFailoverStackProps) {
    super(scope, id, props);

    const {
      primaryRegion = 'us-east-1',
      secondaryRegions = 'us-west-2',
      hostedZoneId,
      dnsRecordName,
      primaryDesiredCount = 2,
      secondaryDesiredCount,
      appPort = 80,
      sampleAppImage = 'public.ecr.aws/nginx/nginx:alpine',
      enableGlobalTables = true,
      healthCheckInterval = 30,
      failoverThreshold = 3,
      recoveryThreshold = 2,
      warmStandby = false,
    } = props;

    const secondaryRegionsList = secondaryRegions.split(',').map(r => r.trim());
    const actualSecondaryDesiredCount = secondaryDesiredCount ?? (warmStandby ? 1 : 0);

    // ==========================================
    // SNS Topic for Notifications
    // ==========================================
    this.notificationTopic = new sns.Topic(this, 'MultiRegionNotifications', {
      topicName: 'multi-region-failover-notifications',
      displayName: 'Multi-Region Failover Notifications',
    });

    // ==========================================
    // Deploy Primary Region
    // ==========================================
    const primaryRegionConfig = getRegionConfig(primaryRegion);
    
    this.primaryStack = new EcsFargateSpotFailoverStack(this, `Primary-${primaryRegion}`, {
      env: { region: primaryRegion, account: process.env.CDK_DEFAULT_ACCOUNT },
      sampleAppDesiredCount: primaryDesiredCount,
      createSampleApp: true,
      appPort,
      enableGlobalTables,
      isCrossRegion: false,
      regionConfig: primaryRegionConfig,
    });

    // ==========================================
    // Deploy Secondary Regions
    // ==========================================
    secondaryRegionsList.forEach((region, index) => {
      const regionConfig = getRegionConfig(region);
      
      const secondaryStack = new EcsFargateSpotFailoverStack(this, `Secondary-${region}`, {
        env: { region, account: process.env.CDK_DEFAULT_ACCOUNT },
        sampleAppDesiredCount: actualSecondaryDesiredCount,
        createSampleApp: true,
        appPort,
        enableGlobalTables,
        isCrossRegion: true,
        primaryRegion,
        regionConfig,
      });

      this.secondaryStacks.push(secondaryStack);
    });

    // ==========================================
    // Multi-Region Failover Construct
    // ==========================================
    const allStacks = [this.primaryStack, ...this.secondaryStacks];
    const allRegions = [primaryRegion, ...secondaryRegionsList];
    
    // Collect NLBs from all regions
    const regionLoadBalancers: Record<string, nlb.INetworkLoadBalancer> = {};
    allStacks.forEach((stack, index) => {
      if (stack.loadBalancer) {
        regionLoadBalancers[allRegions[index]] = stack.loadBalancer;
      }
    });

    this.multiRegionFailover = new MultiRegionFailoverConstruct(this, 'MultiRegionFailover', {
      primaryRegion,
      secondaryRegions: secondaryRegionsList,
      hostedZoneId,
      dnsRecordName,
      enableGlobalTables,
      healthCheckInterval,
      failoverThreshold,
      recoveryThreshold,
      notificationTopic: this.notificationTopic,
      regionLoadBalancers,
    });

    // ==========================================
    // Route53 DNS Configuration
    // ==========================================
    if (hostedZoneId && dnsRecordName) {
      // Primary record with failover routing using CfnRecordSet for full control
      const primaryNlb = this.primaryStack.loadBalancer;
      if (primaryNlb) {
        new route53.CfnRecordSet(this, 'PrimaryDNSRecord', {
          hostedZoneId,
          name: dnsRecordName,
          type: 'A',
          setIdentifier: 'primary',
          failover: 'PRIMARY',
          aliasTarget: {
            hostedZoneId: 'Z26RNL4JYFTOTI', // NLB hosted zone ID for us-east-1
            dnsName: primaryNlb.loadBalancerDnsName,
            evaluateTargetHealth: true,
          },
          healthCheckId: this.multiRegionFailover.route53HealthChecks[primaryRegion]?.attrHealthCheckId,
        });
      }

      // Secondary records
      this.secondaryStacks.forEach((stack, index) => {
        const region = secondaryRegionsList[index];
        if (stack.loadBalancer) {
          new route53.CfnRecordSet(this, `SecondaryDNSRecord-${region}`, {
            hostedZoneId,
            name: dnsRecordName,
            type: 'A',
            setIdentifier: `secondary-${region}`,
            failover: 'SECONDARY',
            aliasTarget: {
              hostedZoneId: 'Z26RNL4JYFTOTI', // NLB hosted zone ID
              dnsName: stack.loadBalancer.loadBalancerDnsName,
              evaluateTargetHealth: true,
            },
            healthCheckId: this.multiRegionFailover.route53HealthChecks[region]?.attrHealthCheckId,
          });
        }
      });
    }

    // ==========================================
    // Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'PrimaryRegion', {
      value: primaryRegion,
      description: 'Primary AWS Region',
    });

    new cdk.CfnOutput(this, 'SecondaryRegions', {
      value: secondaryRegionsList.join(', '),
      description: 'Secondary/DR Regions',
    });

    new cdk.CfnOutput(this, 'DNSRecordName', {
      value: dnsRecordName || 'Not configured',
      description: 'DNS Record Name',
    });

    new cdk.CfnOutput(this, 'WarmStandby', {
      value: warmStandby ? 'Enabled' : 'Disabled (Cold Standby)',
      description: 'Standby Configuration',
    });

    new cdk.CfnOutput(this, 'PrimaryNLB', {
      value: this.primaryStack.loadBalancer?.loadBalancerDnsName || 'N/A',
      description: 'Primary Region NLB DNS',
    });

    this.secondaryStacks.forEach((stack, index) => {
      new cdk.CfnOutput(this, `SecondaryNLB-${secondaryRegionsList[index]}`, {
        value: stack.loadBalancer?.loadBalancerDnsName || 'N/A',
        description: `Secondary Region (${secondaryRegionsList[index]}) NLB DNS`,
      });
    });

    new cdk.CfnOutput(this, 'NotificationTopic', {
      value: this.notificationTopic.topicArn,
      description: 'SNS Topic for Notifications',
    });

    new cdk.CfnOutput(this, 'HealthCheckTable', {
      value: this.multiRegionFailover.healthCheckTable.tableName,
      description: 'Health Check DynamoDB Table',
    });

    new cdk.CfnOutput(this, 'GlobalStateTable', {
      value: this.multiRegionFailover.globalStateTable.tableName,
      description: 'Global State DynamoDB Table',
    });
  }
}
