# Sample Node.js Application for ECS Fargate Spot Failover

This is a sample Node.js application designed to demonstrate and test the ECS Fargate Spot Failover solution. It provides health check endpoints, status information, and the ability to simulate failures for testing failover scenarios.

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Run locally
npm start

# Or with hot reload (requires nodemon)
npx nodemon server.js
```

### Docker (Recommended for Testing)

```bash
# Build and run with Docker
docker build -t sample-app .
docker run -p 8080:8080 -e SERVICE_NAME=myapp sample-app

# Or use docker-compose for complete setup
docker-compose up -d
```

## 🐳 Docker Files

| File | Purpose | Use Case |
|------|---------|----------|
| `Dockerfile` | Standard production build | General use, balanced size/features |
| `Dockerfile.production` | Optimized production build | **AWS Fargate production deployment** |
| `Dockerfile.development` | Development build with hot reload | Local development |
| `docker-compose.yml` | Multi-service orchestration | Local testing with Spot/Standard simulation |

## 📋 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Application info and status |
| `/health` | GET | Health check for NLB (returns 200 if healthy) |
| `/ready` | GET | Readiness probe |
| `/live` | GET | Liveness probe |
| `/status` | GET | Detailed system information |
| `/simulate-failure` | POST | Simulate app crash (for testing failover) |

## 🔧 Testing Failover Locally

### 1. Start Services

```bash
# Start with 2 Spot replicas and 0 Standard (simulating production)
docker-compose up -d

# Check running containers
docker-compose ps
```

### 2. Test Health Endpoint

```bash
# Test health check
curl http://localhost:8080/health

# View status
curl http://localhost:8080/status | jq
```

### 3. Simulate Failover

```bash
# Trigger simulated failure (container will exit after 5 seconds)
curl -X POST http://localhost:8080/simulate-failure

# Watch logs
docker-compose logs -f spot

# Docker Compose will automatically restart the container
```

### 4. Manual Failover Simulation

```bash
# Stop Spot service (simulating Spot capacity issue)
docker-compose stop spot

# Start Standard service (simulating failover)
docker-compose up -d standard
docker-compose scale standard=2

# Test that Standard is serving requests
curl http://localhost:8081/
```

## 🏭 Production Deployment

### Build Production Image

```bash
# Build optimized production image
docker build -f Dockerfile.production -t myapp:v1.0.0 .

# Tag for ECR
docker tag myapp:v1.0.0 YOUR_AWS_ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com/myapp:v1.0.0
```

### Push to Amazon ECR

```bash
# Login to ECR
aws ecr get-login-password --region YOUR_REGION | \
  docker login --username AWS --password-stdin YOUR_AWS_ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com

# Push image
docker push YOUR_AWS_ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com/myapp:v1.0.0
```

### Deploy to ECS

After pushing to ECR, reference the image in your CDK stack:

```typescript
// In your CDK stack
taskDefinition.addContainer('AppContainer', {
  image: ecs.ContainerImage.fromEcrRepository(
    ecr.Repository.fromRepositoryName(stack, 'MyAppRepo', 'myapp'),
    'v1.0.0'
  ),
  // ... other config
});
```

## 🔐 Security Best Practices

This application's Dockerfiles follow security best practices:

- ✅ **Non-root user**: Runs as `nodejs` user (UID 1000)
- ✅ **Minimal base image**: Uses Alpine Linux
- ✅ **Multi-stage build**: Smaller attack surface
- ✅ **No secrets in image**: Use environment variables
- ✅ **Health checks**: Ensures container is actually healthy

## 📝 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Server port |
| `SERVICE_NAME` | unknown | Service identifier |
| `CAPACITY_PROVIDER` | unknown | FARGATE or FARGATE_SPOT |
| `NODE_ENV` | production | Node environment |

## 🧪 Load Testing

```bash
# Install hey (HTTP load generator)
# macOS: brew install hey
# Linux: https://github.com/rakyll/hey/releases

# Run load test
hey -n 10000 -c 100 http://localhost:8080/

# During load test, simulate failure to see failover
```

## 📊 Monitoring Integration

The application outputs structured logs to stdout:

```json
{
  "timestamp": "2024-03-11T10:00:00.000Z",
  "service": "sample-app",
  "capacityProvider": "FARGATE_SPOT",
  "level": "info",
  "message": "Request received"
}
```

These logs are automatically collected by AWS CloudWatch Logs when running on ECS.

## 🔄 Graceful Shutdown

The application handles SIGTERM and SIGINT signals for graceful shutdown:

```javascript
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
```

This ensures ECS can safely stop tasks during deployments or failover.

## 📚 Customization Guide

### Add Custom Endpoints

```javascript
// Add to server.js
app.get('/api/custom', (req, res) => {
  res.json({ data: 'your custom data' });
});
```

### Change Port

```bash
# Environment variable
docker run -e PORT=3000 -p 3000:3000 sample-app
```

### Add Database Connection

```javascript
// Example with MongoDB
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);
```

## 🤝 Contributing

Feel free to modify this sample application for your testing needs. The key requirements for ECS Fargate Spot Failover compatibility are:

1. **Health check endpoint** at `/health` returning HTTP 200
2. **Graceful shutdown** handling SIGTERM
3. **Stateless design** (no local state)
4. **Structured logging** to stdout

## 📄 License

MIT License - same as the main project.
