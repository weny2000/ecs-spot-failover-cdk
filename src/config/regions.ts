/**
 * Multi-Region Configuration for ECS Fargate Spot Failover
 * 
 * This file defines region-specific settings for cross-region deployment.
 */

export interface RegionConfig {
  /** AWS Region code */
  region: string;
  /** Region name for display */
  name: string;
  /** Primary or DR region */
  type: 'primary' | 'dr';
  /** VPC CIDR block for this region */
  vpcCidr: string;
  /** Number of Availability Zones */
  azCount: number;
  /** Capacity provider weights (can vary by region) */
  capacityProviderWeights: {
    fargate: number;
    fargateSpot: number;
  };
  /** Sample app desired count */
  sampleAppDesiredCount: number;
  /** Whether this region is enabled for deployment */
  enabled: boolean;
  /** Route53 health check ID (for DNS failover) */
  healthCheckId?: string;
  /** Cross-region replication settings */
  replication?: {
    sourceRegion: string;
    replicateDynamoDB: boolean;
  };
}

export const DEFAULT_REGION_CONFIG: Record<string, RegionConfig> = {
  'us-east-1': {
    region: 'us-east-1',
    name: 'US East (N. Virginia)',
    type: 'primary',
    vpcCidr: '10.0.0.0/16',
    azCount: 2,
    capacityProviderWeights: {
      fargate: 1,
      fargateSpot: 3,
    },
    sampleAppDesiredCount: 2,
    enabled: true,
  },
  'us-west-2': {
    region: 'us-west-2',
    name: 'US West (Oregon)',
    type: 'dr',
    vpcCidr: '10.1.0.0/16',
    azCount: 2,
    capacityProviderWeights: {
      fargate: 1,
      fargateSpot: 3,
    },
    sampleAppDesiredCount: 2,
    enabled: true,
    replication: {
      sourceRegion: 'us-east-1',
      replicateDynamoDB: true,
    },
  },
  'eu-west-1': {
    region: 'eu-west-1',
    name: 'EU (Ireland)',
    type: 'primary',
    vpcCidr: '10.2.0.0/16',
    azCount: 2,
    capacityProviderWeights: {
      fargate: 1,
      fargateSpot: 3,
    },
    sampleAppDesiredCount: 2,
    enabled: false,
  },
  'ap-southeast-1': {
    region: 'ap-southeast-1',
    name: 'Asia Pacific (Singapore)',
    type: 'dr',
    vpcCidr: '10.3.0.0/16',
    azCount: 2,
    capacityProviderWeights: {
      fargate: 1,
      fargateSpot: 3,
    },
    sampleAppDesiredCount: 2,
    enabled: false,
    replication: {
      sourceRegion: 'us-east-1',
      replicateDynamoDB: true,
    },
  },
};

/**
 * Get region configuration
 * @param region AWS region code
 * @returns Region configuration
 */
export function getRegionConfig(region: string): RegionConfig {
  const config = DEFAULT_REGION_CONFIG[region];
  if (!config) {
    throw new Error(`No configuration found for region: ${region}`);
  }
  return config;
}

/**
 * Get all enabled regions
 * @returns Array of enabled region configurations
 */
export function getEnabledRegions(): RegionConfig[] {
  return Object.values(DEFAULT_REGION_CONFIG).filter(r => r.enabled);
}

/**
 * Get primary regions
 * @returns Array of primary region configurations
 */
export function getPrimaryRegions(): RegionConfig[] {
  return Object.values(DEFAULT_REGION_CONFIG).filter(r => r.type === 'primary' && r.enabled);
}

/**
 * Get DR regions
 * @returns Array of DR region configurations
 */
export function getDRRegions(): RegionConfig[] {
  return Object.values(DEFAULT_REGION_CONFIG).filter(r => r.type === 'dr' && r.enabled);
}

/**
 * Validate region configuration
 * @param regions Array of region codes to validate
 * @returns True if all regions are valid and enabled
 */
export function validateRegions(regions: string[]): boolean {
  return regions.every(region => {
    const config = DEFAULT_REGION_CONFIG[region];
    return config && config.enabled;
  });
}
