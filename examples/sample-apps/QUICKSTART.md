# Quick Start Guide - Sample Applications

Get started with ECS Fargate Spot Failover in 5 minutes using our sample applications.

## ⚡ 5-Minute Quick Start

### Option 1: Test with Default Sample App (Nginx)

```bash
# Clone and deploy the full stack with default nginx sample app
git clone https://github.com/weny2000/ecs-spot-failover-cdk.git
cd ecs-spot-failover-cdk
npm install
npm run deploy

# Get the Load Balancer URL
export NLB_DNS=$(aws cloudformation describe-stacks \\
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

# Test
curl http://$NLB_DNS
curl http://$NLB_DNS/health
```

### Option 2: Test with Custom Node.js Application

```bash
# 1. Build the sample Node.js app
cd examples/sample-apps/nodejs

# 2. Build and push to ECR (automatically creates ECR repo)
./build.sh v1.0.0 us-east-1 my-sample-app

# 3. Back to project root
cd ../../..

# 4. Deploy with your custom app
npm run deploy -- \
  -c sampleAppImage=my-sample-app:v1.0.0 \
  -c appPort=8080
```

### Option 3: Local Docker Testing (No AWS Required)

```bash
cd examples/sample-apps/nodejs

# Start with docker-compose
docker-compose up -d

# Test
curl http://localhost:8080/health
curl http://localhost:8080/status

# Simulate Spot failure
curl -X POST http://localhost:8080/simulate-failure

# View logs
docker-compose logs -f

# Cleanup
docker-compose down
```

## 📖 Step-by-Step Tutorial

### Step 1: Choose Your Language

We provide sample applications in three languages:

```bash
# Node.js - Best for web APIs
cd examples/sample-apps/nodejs

# Python - Best for data processing
cd examples/sample-apps/python

# Go - Best for high performance
cd examples/sample-apps/go
```

### Step 2: Understand the Docker Files

Each sample includes multiple Dockerfiles:

| File | Purpose | When to Use |
|------|---------|-------------|
| `Dockerfile` | Standard build | Quick testing |
| `Dockerfile.production` | **Optimized for AWS Fargate** | **Production deployment** |
| `Dockerfile.development` | Hot reload enabled | Local development |

### Step 3: Test Locally

```bash
# Build production image
docker build -f Dockerfile.production -t myapp:v1.0.0 .

# Run locally
docker run -p 8080:8080 \
  -e SERVICE_NAME=myapp \
  -e CAPACITY_PROVIDER=FARGATE_SPOT \
  myapp:v1.0.0

# Test endpoints
curl http://localhost:8080/health    # Health check
curl http://localhost:8080/status    # System status
curl http://localhost:8080/          # Main endpoint
```

### Step 4: Push to Amazon ECR

We provide build scripts for convenience:

```bash
# Using the script (Bash)
./build.sh v1.0.0 us-east-1 myapp

# Or using PowerShell (Windows)
.\build.ps1 v1.0.0 us-east-1 myapp

# Or manually:
# 1. Login
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# 2. Build
docker build -f Dockerfile.production -t myapp:v1.0.0 .

# 3. Tag
docker tag myapp:v1.0.0 \
  YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/myapp:v1.0.0

# 4. Push
docker push YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/myapp:v1.0.0
```

### Step 5: Deploy to ECS

The main CDK stack supports custom images through context:

```bash
# Deploy with your custom image
cd ../../../  # Back to project root
npm run deploy -- \
  -c createSampleApp=true \
  -c sampleAppImage=myapp:v1.0.0 \
  -c appPort=8080 \
  -c sampleAppDesiredCount=2
```

Or modify the stack to use your image directly:

```typescript
// In src/ecs-fargate-spot-failover-stack.ts
spotTaskDef.addContainer('AppContainer', {
  image: ecs.ContainerImage.fromEcrRepository(
    ecr.Repository.fromRepositoryName(stack, 'MyAppRepo', 'myapp'),
    'v1.0.0'
  ),
  // ... rest of config
});
```

### Step 6: Test Failover

```bash
# Get the NLB DNS
export NLB_DNS=$(aws cloudformation describe-stacks \\
  --stack-name EcsFargateSpotFailoverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

# Trigger failure (this will crash the container)
curl -X POST http://$NLB_DNS/simulate-failure

# Watch CloudWatch logs to see failover in action
aws logs tail /ecs/your-cluster-name --follow

# Check that service switched to Standard Fargate
aws ecs describe-services \
  --cluster fargate-spot-cluster \
  --services sample-app sample-app-standard
```

## 🔧 Customization Guide

### Adding Your Own Business Logic

The sample apps are designed to be easily extended. Here's how to add a custom endpoint:

**Node.js Example:**
```javascript
// In server.js, add before app.listen()
app.get('/api/users', async (req, res) => {
  // Your database query here
  const users = await db.getUsers();
  res.json({ users });
});
```

**Python Example:**
```python
# In server.py, add before if __name__
@app.route('/api/users')
def get_users():
    # Your database query here
    users = db.get_users()
    return jsonify({'users': users})
```

**Go Example:**
```go
// In main.go, add in main() before http.ListenAndServe
http.HandleFunc("/api/users", func(w http.ResponseWriter, r *http.Request) {
    // Your database query here
    users := db.GetUsers()
    json.NewEncoder(w).Encode(map[string]interface{}{"users": users})
})
```

### Environment Variables

Add your own environment variables:

```bash
# When running locally
docker run -e DATABASE_URL=postgres://... -e API_KEY=secret myapp

# When deploying to ECS (add to CDK stack)
environment: {
  DATABASE_URL: 'postgres://...',
  API_KEY: 'secret',
}
```

### Database Connection Example

**Node.js + PostgreSQL:**
```javascript
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.get('/api/data', async (req, res) => {
  const result = await pool.query('SELECT * FROM mytable');
  res.json(result.rows);
});
```

## 📊 Testing Scenarios

### Scenario 1: Spot Instance Interruption

```bash
# Simulate multiple Spot failures
for i in {1..5}; do
  curl -X POST http://$NLB_DNS/simulate-failure
  sleep 2
done

# Check DynamoDB error counter
aws dynamodb get-item \
  --table-name fargate-spot-error-counter \
  --key '{"service_name": {"S": "sample-app"}}'

# After 3 failures, failover should trigger
# Check that standard service is now running
aws ecs describe-services \
  --cluster fargate-spot-cluster \
  --services sample-app-standard
```

### Scenario 2: Recovery Testing

```bash
# After failover, wait for Spot to recover
# The cleanup orchestrator will automatically switch back

# Monitor the process
aws logs tail /aws/lambda/EcsFargateSpotFailoverStack-SpotSuccessMonitor --follow

# Verify Spot is running again
aws ecs describe-services \
  --cluster fargate-spot-cluster \
  --services sample-app
```

## 🐛 Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs <container-id>

# Verify environment variables
docker run --rm myapp:v1.0.0 env

# Test locally with same env vars
docker run -e PORT=8080 -e SERVICE_NAME=test -p 8080:8080 myapp:v1.0.0
```

### Health Check Failing

```bash
# Test health endpoint locally
curl http://localhost:8080/health

# Check if app is binding to correct interface
# Should bind to 0.0.0.0, not localhost
```

### Image Push Failing

```bash
# Verify ECR login
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# Check IAM permissions
aws sts get-caller-identity

# Ensure repo exists
aws ecr describe-repositories --repository-names myapp
```

## 📚 Next Steps

- Read the [full deployment guide](../../docs/deployment-guide.md)
- Learn about [monitoring and operations](../../docs/operations-manual.md)
- Understand the [architecture](../../docs/architecture-overview.md)

## 🤝 Need Help?

- Open an [issue](https://github.com/weny2000/ecs-spot-failover-cdk/issues)
- Check the [troubleshooting guide](../../README.md#troubleshooting)
