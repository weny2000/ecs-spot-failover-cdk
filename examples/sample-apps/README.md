# Sample Applications for ECS Fargate Spot Failover

This directory contains sample applications in multiple languages that you can use to test the ECS Fargate Spot Failover solution or as a starting point for your own applications.

## 📁 Available Samples

| Language | Directory | Best For | Image Size |
|----------|-----------|----------|------------|
| **Node.js** | [nodejs/](nodejs/) | Web APIs, Microservices | ~150MB |
| **Python** | [python/](python/) | Data processing, ML inference | ~120MB |
| **Go** | [go/](go/) | High performance, small footprint | ~20MB |

## 🎯 Quick Comparison

```bash
# Node.js - Easy to develop, large ecosystem
cd nodejs && docker build -t sample-nodejs .

# Python - Great for data/ML workloads
cd python && docker build -t sample-python .

# Go - Best performance, smallest image
cd go && docker build -t sample-go .
```

## 🚀 Common Features

All sample applications provide:

- ✅ **Health check endpoint** (`/health`) - Required for NLB
- ✅ **Readiness probe** (`/ready`) - For Kubernetes-style orchestration
- ✅ **Liveness probe** (`/live`) - For container health monitoring
- ✅ **Status endpoint** (`/status`) - System information
- ✅ **Failure simulation** (`/simulate-failure`) - Test failover scenarios
- ✅ **Graceful shutdown** - Handle SIGTERM properly
- ✅ **Structured logging** - JSON format for CloudWatch
- ✅ **Security hardening** - Non-root user, minimal attack surface

## 🏭 Production Deployment

### Step 1: Choose Your Language

**Node.js** - Best for:
- Web applications and APIs
- Microservices
- Teams familiar with JavaScript/TypeScript

**Python** - Best for:
- Data processing pipelines
- Machine learning inference
- Scientific computing

**Go** - Best for:
- High-throughput services
- Low latency requirements
- Minimal resource usage

### Step 2: Build Production Image

Each sample includes a production-optimized Dockerfile:

```bash
cd nodejs  # or python, go

# Build production image
docker build -f Dockerfile.production -t myapp:v1.0.0 .
```

**Production Dockerfile Features:**
- Multi-stage builds for minimal image size
- Security-hardened (non-root user, minimal packages)
- Health checks built-in
- Optimized for AWS Fargate

### Step 3: Push to Amazon ECR

```bash
# Use the provided build script
./build.sh v1.0.0 us-east-1 myapp

# Or manually:
# 1. Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# 2. Tag and push
docker tag myapp:v1.0.0 YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/myapp:v1.0.0
docker push YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/myapp:v1.0.0
```

### Step 4: Deploy with CDK

Update your CDK stack to use your image:

```typescript
// In your CDK stack
taskDefinition.addContainer('AppContainer', {
  image: ecs.ContainerImage.fromEcrRepository(
    ecr.Repository.fromRepositoryName(stack, 'MyAppRepo', 'myapp'),
    'v1.0.0'
  ),
  portMappings: [{ containerPort: 8080 }],
  healthCheck: {
    command: ['CMD-SHELL', 'curl -f http://localhost:8080/health || exit 1'],
    interval: Duration.seconds(30),
    timeout: Duration.seconds(5),
    retries: 3,
  },
  logging: ecs.LogDriver.awsLogs({
    streamPrefix: 'myapp',
    logGroup: new logs.LogGroup(stack, 'MyAppLogs'),
  }),
});
```

Or use the main stack with context:

```bash
# Deploy with custom image
npm run deploy -- \
  -c createSampleApp=true \
  -c appImage=myapp:v1.0.0 \
  -c appPort=8080 \
  -c sampleAppDesiredCount=3
```

## 🧪 Local Testing

### Docker Compose (Recommended)

The Node.js sample includes a complete docker-compose setup:

```bash
cd nodejs

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Test endpoints
curl http://localhost:8080/health
curl http://localhost:8080/status

# Simulate failover
curl -X POST http://localhost:8080/simulate-failure

# Scale services
docker-compose up -d --scale spot=4
docker-compose up -d --scale standard=2

# Stop
docker-compose down
```

### Individual Container

```bash
cd nodejs  # or python, go

# Build
docker build -t sample-app .

# Run
docker run -p 8080:8080 \
  -e SERVICE_NAME=myapp \
  -e CAPACITY_PROVIDER=FARGATE_SPOT \
  sample-app

# Test
curl http://localhost:8080/health
```

## 📋 Environment Variables

All samples support these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Server port |
| `SERVICE_NAME` | unknown | Service identifier (shows in logs/status) |
| `CAPACITY_PROVIDER` | unknown | FARGATE or FARGATE_SPOT |

## 🔧 Customization

### Adding Your Own Endpoints

Each sample is designed to be easily extensible:

**Node.js (Express):**
```javascript
app.get('/api/my-endpoint', (req, res) => {
  res.json({ data: 'my data' });
});
```

**Python (Flask):**
```python
@app.route('/api/my-endpoint')
def my_endpoint():
    return jsonify({'data': 'my data'})
```

**Go (Gin/Fiber):**
```go
app.Get("/api/my-endpoint", func(c *fiber.Ctx) error {
    return c.JSON(fiber.Map{"data": "my data"})
})
```

### Connecting to Databases

Examples for common databases:

**Node.js + MongoDB:**
```javascript
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);
```

**Python + PostgreSQL:**
```python
import psycopg2
conn = psycopg2.connect(os.environ['DATABASE_URL'])
```

**Go + Redis:**
```go
import "github.com/go-redis/redis/v8"
rdb := redis.NewClient(&redis.Options{
    Addr: os.Getenv("REDIS_URL"),
})
```

## 📊 Performance Comparison

| Metric | Node.js | Python | Go |
|--------|---------|--------|-----|
| **Startup Time** | ~2s | ~1s | ~100ms |
| **Memory (idle)** | ~50MB | ~40MB | ~10MB |
| **Image Size** | ~150MB | ~120MB | ~20MB |
| **Req/sec (single core)** | ~10k | ~5k | ~50k |
| **Cold Start** | Medium | Medium | Fast |

## 🔒 Security Checklist

All samples implement:

- ✅ Non-root user (UID 1000)
- ✅ Minimal base image (Alpine Linux)
- ✅ No secrets in image
- ✅ Health checks configured
- ✅ Graceful shutdown handling
- ✅ Security headers (where applicable)

Before production deployment:
- [ ] Scan image for vulnerabilities (`docker scan` or Trivy)
- [ ] Enable image signing with Notary/Cosign
- [ ] Set up image lifecycle policies in ECR
- [ ] Configure log retention
- [ ] Review IAM permissions

## 🤝 Contributing

If you create a sample in another language:

1. Create a new directory (e.g., `rust/`, `java/`)
2. Include Dockerfile and Dockerfile.production
3. Provide the same endpoints as other samples
4. Add README.md with language-specific instructions
5. Test with docker-compose

## 📚 Additional Resources

- [AWS ECS Task Definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [AWS Fargate Considerations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)

## 📄 License

MIT License - same as the main project.
