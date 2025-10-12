#!/bin/bash

# System status monitoring script
# Usage: ./monitor-system.sh [cluster-name]

CLUSTER_NAME=${1:-"fargate-spot-cluster"}

echo "=== ECS Fargate Spot Failover System Monitor ==="
echo "Cluster: $CLUSTER_NAME"
echo "Time: $(date)"
echo ""

# Function: Display service status
show_service_status() {
    local service_name=$1
    
    SERVICE_INFO=$(aws ecs describe-services --cluster $CLUSTER_NAME --services $service_name --query 'services[0]' --output json 2>/dev/null)
    
    if [ $? -eq 0 ] && [ "$SERVICE_INFO" != "null" ]; then
        DESIRED_COUNT=$(echo $SERVICE_INFO | jq -r '.desiredCount')
        RUNNING_COUNT=$(echo $SERVICE_INFO | jq -r '.runningCount')
        PENDING_COUNT=$(echo $SERVICE_INFO | jq -r '.pendingCount')
        STATUS=$(echo $SERVICE_INFO | jq -r '.status')
        
        printf "%-25s | Desired: %-2s | Running: %-2s | Pending: %-2s | Status: %s\n" \
            "$service_name" "$DESIRED_COUNT" "$RUNNING_COUNT" "$PENDING_COUNT" "$STATUS"
    else
        printf "%-25s | Service does not exist or is inaccessible\n" "$service_name"
    fi
}

# Function: Display DynamoDB status
show_dynamodb_status() {
    echo "DynamoDB Error Counter Status:"
    echo "----------------------------------------"
    
    # Scan all records
    ITEMS=$(aws dynamodb scan --table-name fargate-spot-error-counter --output json 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        echo $ITEMS | jq -r '.Items[] | 
            "Service: " + .service_name.S + 
            " | Error Count: " + (.error_count.N // "0") + 
            " | Last Error: " + (.last_error_time.S // "None") + 
            " | Failover: " + (if .failover_state.M.failover_active.BOOL then "Active" else "Inactive" end)'
    else
        echo "Unable to access DynamoDB table"
    fi
    echo ""
}

# Function: Display recent CloudWatch logs
show_recent_logs() {
    local function_name=$1
    local lines=${2:-10}
    
    echo "Recent $function_name logs (latest $lines entries):"
    echo "----------------------------------------"
    
    LOG_GROUP="/aws/lambda/EcsFargateSpotFailoverStack-$function_name"
    
    # Get the latest log stream
    LATEST_STREAM=$(aws logs describe-log-streams \
        --log-group-name $LOG_GROUP \
        --order-by LastEventTime \
        --descending \
        --max-items 1 \
        --query 'logStreams[0].logStreamName' \
        --output text 2>/dev/null)
    
    if [ "$LATEST_STREAM" != "None" ] && [ -n "$LATEST_STREAM" ]; then
        aws logs get-log-events \
            --log-group-name $LOG_GROUP \
            --log-stream-name $LATEST_STREAM \
            --limit $lines \
            --query 'events[].message' \
            --output text 2>/dev/null | tail -n $lines
    else
        echo "No logs found or unable to access"
    fi
    echo ""
}

# Main monitoring loop
while true; do
    clear
    echo "=== ECS Fargate Spot Failover System Monitor ==="
    echo "Cluster: $CLUSTER_NAME"
    echo "Time: $(date)"
    echo ""
    
    # Display service status
    echo "ECS Service Status:"
    echo "----------------------------------------"
    printf "%-25s | %-8s | %-6s | %-8s | %s\n" "Service Name" "Desired" "Running" "Pending" "Status"
    echo "----------------------------------------"
    
    # Get all services in the cluster
    SERVICES=$(aws ecs list-services --cluster $CLUSTER_NAME --query 'serviceArns[]' --output text 2>/dev/null)
    
    if [ -n "$SERVICES" ]; then
        for SERVICE_ARN in $SERVICES; do
            SERVICE_NAME=$(basename $SERVICE_ARN)
            show_service_status $SERVICE_NAME
        done
    else
        echo "No services found or unable to access cluster"
    fi
    echo ""
    
    # Display DynamoDB status
    show_dynamodb_status
    
    # Display recent Lambda logs
    echo "Lambda Function Status:"
    echo "----------------------------------------"
    show_recent_logs "SpotErrorDetector" 3
    show_recent_logs "FargateFailbackOrchestrator" 3
    show_recent_logs "SpotSuccessMonitor" 3
    show_recent_logs "CleanupOrchestrator" 3
    
    echo "Press Ctrl+C to exit monitoring, or wait 30 seconds for auto refresh..."
    sleep 30
done