#!/bin/bash

# Script to test failover functionality
# Usage: ./test-failover.sh <cluster-name> <service-name>

set -e

CLUSTER_NAME=${1:-"fargate-spot-cluster"}
SERVICE_NAME=${2:-"sample-app"}

echo "Starting failover functionality test..."
echo "Cluster: $CLUSTER_NAME"
echo "Service: $SERVICE_NAME"

# Function: Stop all tasks to simulate Spot interruption
simulate_spot_interruption() {
    echo "Simulating Spot instance interruption..."
    
    # Get currently running tasks
    TASK_ARNS=$(aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --query 'taskArns[]' --output text)
    
    if [ -z "$TASK_ARNS" ]; then
        echo "No running tasks found"
        return
    fi
    
    # Stop all tasks
    for TASK_ARN in $TASK_ARNS; do
        echo "Stopping task: $TASK_ARN"
        aws ecs stop-task --cluster $CLUSTER_NAME --task $TASK_ARN --reason "Simulated Spot interruption for testing"
    done
}

# Function: Monitor service status
monitor_service_status() {
    local service_name=$1
    local max_checks=${2:-30}
    local check_interval=${3:-10}
    
    echo "Monitoring service $service_name status..."
    
    for i in $(seq 1 $max_checks); do
        SERVICE_INFO=$(aws ecs describe-services --cluster $CLUSTER_NAME --services $service_name --query 'services[0]' --output json)
        
        DESIRED_COUNT=$(echo $SERVICE_INFO | jq -r '.desiredCount')
        RUNNING_COUNT=$(echo $SERVICE_INFO | jq -r '.runningCount')
        PENDING_COUNT=$(echo $SERVICE_INFO | jq -r '.pendingCount')
        
        echo "[$i/$max_checks] Service $service_name - Desired: $DESIRED_COUNT, Running: $RUNNING_COUNT, Pending: $PENDING_COUNT"
        
        if [ "$RUNNING_COUNT" -eq "$DESIRED_COUNT" ] && [ "$PENDING_COUNT" -eq "0" ]; then
            echo "Service $service_name has reached stable state"
            return 0
        fi
        
        sleep $check_interval
    done
    
    echo "Warning: Service $service_name did not reach stable state within $((max_checks * check_interval)) seconds"
    return 1
}

# Function: Check error count in DynamoDB
check_error_count() {
    echo "Checking error counter..."
    
    ERROR_COUNT=$(aws dynamodb get-item \
        --table-name fargate-spot-error-counter \
        --key '{"service_name":{"S":"'$SERVICE_NAME'"}}' \
        --query 'Item.error_count.N' \
        --output text 2>/dev/null || echo "0")
    
    if [ "$ERROR_COUNT" = "None" ]; then
        ERROR_COUNT=0
    fi
    
    echo "Current error count: $ERROR_COUNT"
    return $ERROR_COUNT
}

# Function: Check failover status
check_failover_status() {
    echo "Checking failover status..."
    
    FAILOVER_STATE=$(aws dynamodb get-item \
        --table-name fargate-spot-error-counter \
        --key '{"service_name":{"S":"'$SERVICE_NAME'"}}' \
        --query 'Item.failover_state.M.failover_active.BOOL' \
        --output text 2>/dev/null || echo "false")
    
    if [ "$FAILOVER_STATE" = "true" ]; then
        echo "Failover status: Active"
        return 0
    else
        echo "Failover status: Inactive"
        return 1
    fi
}

echo "=== Test Started ==="

# 1. Check initial state
echo "1. Checking initial service status..."
monitor_service_status $SERVICE_NAME 5 5
monitor_service_status "${SERVICE_NAME}-standard" 5 5

# 2. First simulated interruption
echo "2. First simulated Spot interruption..."
simulate_spot_interruption
sleep 30
check_error_count

# 3. Second simulated interruption
echo "3. Second simulated Spot interruption..."
simulate_spot_interruption
sleep 30
check_error_count

# 4. Third simulated interruption (should trigger failover)
echo "4. Third simulated Spot interruption (should trigger failover)..."
simulate_spot_interruption
sleep 60

# 5. Check if failover was triggered
echo "5. Checking failover status..."
if check_failover_status; then
    echo "✅ Failover has been triggered"
    
    # Monitor standard service startup
    echo "6. Monitoring standard Fargate service startup..."
    monitor_service_status "${SERVICE_NAME}-standard" 20 15
    
    # Check if Spot service was stopped
    echo "7. Checking Spot service status..."
    monitor_service_status $SERVICE_NAME 10 10
    
else
    echo "❌ Failover was not triggered, please check configuration"
fi

echo "=== Test Completed ==="
echo ""
echo "Test Results Summary:"
echo "- Check CloudWatch logs to view detailed Lambda execution logs"
echo "- Check SNS notifications to confirm notification functionality is working"
echo "- If failover was successful, the backup environment should automatically clean up after Spot instances recover"