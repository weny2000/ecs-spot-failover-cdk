#!/usr/bin/env node
/**
 * Multi-Region Deployment Script
 * 
 * This script deploys the CDK stack to multiple AWS regions.
 * Usage:
 *   npm run deploy:multi                    # Deploy to all enabled regions for current environment
 *   npm run deploy:multi -- --regions us-east-1,us-west-2  # Deploy to specific regions
 *   npm run deploy:multi -- --env prod      # Deploy to production regions
 *   npm run deploy:multi -- --global-tables # Enable DynamoDB Global Tables
 */

const { execSync } = require('child_process');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  regions: null,
  env: process.env.DEPLOY_ENV || 'staging',
  globalTables: false,
  parallel: true,
  dryRun: false,
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '--regions':
      options.regions = args[++i].split(',').map(r => r.trim());
      break;
    case '--env':
    case '--environment':
      options.env = args[++i];
      break;
    case '--global-tables':
      options.globalTables = true;
      break;
    case '--sequential':
      options.parallel = false;
      break;
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--help':
    case '-h':
      console.log(`
Multi-Region Deployment Script

Usage: npm run deploy:multi [options]

Options:
  --regions <list>     Comma-separated list of regions (e.g., us-east-1,us-west-2)
  --env <environment>  Deployment environment (dev, staging, prod) [default: staging]
  --global-tables      Enable DynamoDB Global Tables for cross-region replication
  --sequential         Deploy regions sequentially instead of in parallel
  --dry-run            Show what would be deployed without actually deploying
  --help, -h           Show this help message

Examples:
  npm run deploy:multi                                    # Deploy to all enabled regions
  npm run deploy:multi -- --regions us-east-1,us-west-2   # Deploy to specific regions
  npm run deploy:multi -- --env prod --global-tables      # Production with global tables
`);
      process.exit(0);
    default:
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
  }
}

// Load regions configuration
const { getDeploymentRegions } = require('../dist/config/regions');

const regions = options.regions || getDeploymentRegions(options.env);

console.log(`
╔══════════════════════════════════════════════════════════════╗
║         ECS Fargate Spot Failover - Multi-Region Deploy      ║
╠══════════════════════════════════════════════════════════════╣
  Environment: ${options.env}
  Regions:     ${regions.join(', ')}
  Global Tables: ${options.globalTables ? 'Yes' : 'No'}
  Mode:        ${options.parallel ? 'Parallel' : 'Sequential'}
  Dry Run:     ${options.dryRun ? 'Yes' : 'No'}
╚══════════════════════════════════════════════════════════════╝
`);

if (options.dryRun) {
  console.log('🔍 Dry run mode - no actual deployment will occur\n');
  regions.forEach(region => {
    console.log(`Would deploy to ${region}:`);
    console.log(`  cdk deploy -c region=${region} -c environment=${options.env} -c createSampleApp=false${options.globalTables ? ' -c enableGlobalTables=true' : ''}`);
  });
  process.exit(0);
}

// Track deployment results
const results = [];

// Deploy to a single region
function deployToRegion(region) {
  const stackName = `EcsFargateSpotFailoverStack-${region}`;
  console.log(`\n🚀 Starting deployment to ${region}...`);
  console.log(`   Stack: ${stackName}`);
  
  const startTime = Date.now();
  
  try {
    const contextParams = [
      `-c region=${region}`,
      `-c environment=${options.env}`,
      `-c createSampleApp=false`,
    ];
    
    if (options.globalTables) {
      contextParams.push('-c enableGlobalTables=true');
    }
    
    const command = `cdk deploy ${stackName} --require-approval never ${contextParams.join(' ')}`;
    
    console.log(`   Command: ${command}`);
    
    execSync(command, {
      stdio: 'inherit',
      env: {
        ...process.env,
        CDK_DEFAULT_REGION: region,
      },
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`\n✅ Successfully deployed to ${region} (${duration}s)`);
    
    results.push({ region, status: 'success', duration });
    return true;
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(0);
    console.error(`\n❌ Failed to deploy to ${region} (${duration}s)`);
    console.error(`   Error: ${error.message}`);
    
    results.push({ region, status: 'failed', duration, error: error.message });
    return false;
  }
}

// Execute deployments
async function main() {
  console.log(`\n📦 Building TypeScript...`);
  execSync('npm run build', { stdio: 'inherit' });
  
  if (options.parallel) {
    console.log(`\n🔄 Deploying to ${regions.length} regions in parallel...`);
    
    // Deploy all regions in parallel
    const deployments = regions.map(region => deployToRegion(region));
    await Promise.all(deployments);
  } else {
    console.log(`\n🔄 Deploying to ${regions.length} regions sequentially...`);
    
    // Deploy regions one by one
    for (const region of regions) {
      deployToRegion(region);
    }
  }
  
  // Print summary
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    Deployment Summary                        ║
╠══════════════════════════════════════════════════════════════╣`);
  
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'failed');
  
  results.forEach(result => {
    const icon = result.status === 'success' ? '✅' : '❌';
    console.log(`  ${icon} ${result.region.padEnd(15)} ${result.status.padEnd(10)} ${result.duration}s`);
  });
  
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`  Total: ${results.length} | ✅ Success: ${successful.length} | ❌ Failed: ${failed.length}`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
  
  if (failed.length > 0) {
    console.error('❌ Some deployments failed. Check the logs above for details.');
    process.exit(1);
  }
  
  console.log('✅ All deployments completed successfully!');
  
  // Post-deployment instructions
  console.log(`
📋 Next Steps:
  1. Verify CloudWatch dashboards in each region:
     ${regions.map(r => `     - https://console.aws.amazon.com/cloudwatch/home?region=${r}#dashboards`).join('\n')}
  
  2. Test the failover functionality:
     $ npm run test:integration
  
  3. Configure Route53 health checks if needed for DNS failover
  
  4. Review X-Ray service maps:
     ${regions.map(r => `     - https://console.aws.amazon.com/xray/home?region=${r}#/service-map`).join('\n')}
`);
}

main().catch(error => {
  console.error('❌ Deployment script failed:', error);
  process.exit(1);
});
