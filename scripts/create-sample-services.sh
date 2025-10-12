#!/bin/bash

# Script to create sample ECS services
# Usage: ./create-sample-services.sh <cluster-name> <subnet-id-1> <subnet-id-2> <security-group-id>

set -e

CLUSTER_NAME=${1:-"fargate-spot-cluster"}
SUBNET_1=${2:-"subnet-xxx"}
SUBNET_2=${3:-"subnet-yyy"}
SECURITY_GROUP=${4:-"sg-xxx"}

echo "Creating sample ECS services..."
echo "Cluster name: $CLUSTER_NAME"
echo "Subnets: $SUBNET_1, $SUBNET_2"
echo "Security group: $SECURITY_GROUP"

# Create task definition
echo "Creating task definition..."
cat > task-definition.json << EOF
{
  "family": "sample-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "sample-app",
      "image": "nginx:latest",
      "portMappings": [
        {
          "containerPort": 80,
          "protocol": "tcp"
        }
      ],
      "essential": true,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/sample-app",
          "awslogs-region": "$(aws configure get region)",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
EOF

# Register task definition
aws ecs register-task-definition --cli-input-json file://task-definition.json

# Create CloudWatch log group
aws logs create-log-group --log-group-name /ecs/sample-app || true

# Create Spot service
echo "Creating Spot service..."
cat > spot-service.json << EOF
{
  "serviceName": "sample-app",
  "cluster": "$CLUSTER_NAME",
  "taskDefinition": "sample-app",
  "desiredCount": 2,
  "capacityProviderStrategy": [
    {
      "capacityProvider": "FARGATE_SPOT",
      "weight": 1
    }
  ],
  "networkConfiguration": {
    "awsvpcConfiguration": {
      "subnets": ["$SUBNET_1", "$SUBNET_2"],
      "securityGroups": ["$SECURITY_GROUP"],
      "assignPublicIp": "ENABLED"
    }
  },
  "tags": [
    {
      "key": "Environment",
      "value": "production"
    },
    {
      "key": "ServiceType",
      "value": "spot"
    }
  ]
}
EOF

aws ecs create-service --cli-input-json file://spot-service.json

# Create standard Fargate service (backup, initial desired task count is 0)
echo "Creating standard Fargate backup service..."
cat > standard-service.json << EOF
{
  "serviceName": "sample-app-standard",
  "cluster": "$CLUSTER_NAME",
  "taskDefinition": "sample-app",
  "desiredCount": 0,
  "capacityProviderStrategy": [
    {
      "capacityProvider": "FARGATE",
      "weight": 1
    }
  ],
  "networkConfiguration": {
    "awsvpcConfiguration": {
      "subnets": ["$SUBNET_1", "$SUBNET_2"],
      "securityGroups": ["$SECURITY_GROUP"],
      "assignPublicIp": "ENABLED"
    }
  },
  "tags": [
    {
      "key": "Environment",
      "value": "production"
    },
    {
      "key": "ServiceType",
      "value": "standard"
    },
    {
      "key": "BackupFor",
      "value": "sample-app"
    }
  ]
}
EOF

aws ecs create-service --cli-input-json file://standard-service.json

# Clean up temporary files
rm -f task-definition.json spot-service.json standard-service.json

echo "Sample services created successfully!"
echo "Spot service: sample-app (desired task count: 2)"
echo "Standard service: sample-app-standard (desired task count: 0)"
echo ""
echo "You can now test the failover functionality."