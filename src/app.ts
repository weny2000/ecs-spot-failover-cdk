#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsFargateSpotFailoverStack } from './ecs-fargate-spot-failover-stack';

const app = new cdk.App();
new EcsFargateSpotFailoverStack(app, 'EcsFargateSpotFailoverStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});