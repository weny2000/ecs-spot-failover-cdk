#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsFargateSpotFailoverStack, EcsFargateSpotFailoverStackProps } from './ecs-fargate-spot-failover-stack';
import { getRegionConfig, getEnabledRegions, validateRegions } from './config/regions';

const app = new cdk.App();

// Get configuration from context
const createSampleApp = app.node.tryGetContext('createSampleApp') !== 'false';
const sampleAppDesiredCount = parseInt(app.node.tryGetContext('sampleAppDesiredCount') || '2');
const appPort = parseInt(app.node.tryGetContext('appPort') || '80');

// Multi-region deployment configuration
const deployRegions = app.node.tryGetContext('deployRegions') as string[];
const isMultiRegion = app.node.tryGetContext('multiRegion') === 'true';
const enableGlobalTables = app.node.tryGetContext('enableGlobalTables') === 'true';

// Determine which regions to deploy to
let targetRegions: string[] = [];

if (deployRegions && deployRegions.length > 0) {
  // Use explicitly specified regions
  targetRegions = deployRegions;
} else if (isMultiRegion) {
  // Deploy to all enabled regions
  targetRegions = getEnabledRegions().map(r => r.region);
} else {
  // Single region deployment - use env or default
  const envRegion = process.env.CDK_DEFAULT_REGION || 'us-east-1';
  targetRegions = [envRegion];
}

// Validate regions
if (!validateRegions(targetRegions)) {
  console.error('Invalid or disabled regions specified:', targetRegions);
  process.exit(1);
}

console.log('Deploying to regions:', targetRegions.join(', '));

// Deploy stack to each target region
targetRegions.forEach((region, index) => {
  const regionConfig = getRegionConfig(region);
  const isPrimary = regionConfig.type === 'primary';
  
  // Stack name includes region for multi-region deployments
  const stackName = isMultiRegion 
    ? `EcsFargateSpotFailoverStack-${region}`
    : 'EcsFargateSpotFailoverStack';

  const stackProps: EcsFargateSpotFailoverStackProps = {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: region,
    },
    createSampleApp,
    sampleAppDesiredCount: regionConfig.sampleAppDesiredCount || sampleAppDesiredCount,
    appPort,
    regionConfig,
    isCrossRegion: isMultiRegion,
    primaryRegion: isPrimary ? undefined : getEnabledRegions().find(r => r.type === 'primary')?.region,
    enableGlobalTables: isMultiRegion && enableGlobalTables,
  };

  new EcsFargateSpotFailoverStack(app, stackName, stackProps);
});

// Add tags
cdk.Tags.of(app).add('Project', 'ECS-Fargate-Spot-Failover');
cdk.Tags.of(app).add('ManagedBy', 'CDK');

if (isMultiRegion) {
  cdk.Tags.of(app).add('DeploymentType', 'Multi-Region');
}
