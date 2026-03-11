# Sample Node.js Application for ECS Fargate Spot Failover Testing
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Create health check endpoint
EXPOSE 8080

# Non-root user for security
USER node

CMD ["node", "server.js"]
