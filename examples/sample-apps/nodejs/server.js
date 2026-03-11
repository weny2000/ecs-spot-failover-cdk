/**
 * Sample Node.js Application for ECS Fargate Spot Failover Testing
 * 
 * This application provides:
 * - Health check endpoint for NLB
 * - Status endpoint showing container metadata
 * - Simulated failure endpoint for testing failover
 */

const express = require('express');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8080;
const SERVICE_NAME = process.env.SERVICE_NAME || 'unknown';
const CAPACITY_PROVIDER = process.env.CAPACITY_PROVIDER || 'unknown';

// Middleware
app.use(express.json());

// Health check endpoint for NLB
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    capacityProvider: CAPACITY_PROVIDER,
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'ECS Fargate Spot Failover Sample Application',
    service: SERVICE_NAME,
    capacityProvider: CAPACITY_PROVIDER,
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Status endpoint with detailed information
app.get('/status', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    capacityProvider: CAPACITY_PROVIDER,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    memory: {
      total: Math.round(os.totalmem() / 1024 / 1024) + 'MB',
      free: Math.round(os.freemem() / 1024 / 1024) + 'MB'
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Simulate failure endpoint (for testing failover)
app.post('/simulate-failure', (req, res) => {
  console.error('Simulating application failure...');
  res.status(500).json({
    error: 'Simulated failure',
    message: 'This is a test failure to trigger failover',
    timestamp: new Date().toISOString()
  });
  
  // Exit after 5 seconds to simulate crash
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

// Readiness probe endpoint
app.get('/ready', (req, res) => {
  res.status(200).json({
    ready: true,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString()
  });
});

// Liveness probe endpoint
app.get('/live', (req, res) => {
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Sample app running on port ${PORT}`);
  console.log(`Service: ${SERVICE_NAME}`);
  console.log(`Capacity Provider: ${CAPACITY_PROVIDER}`);
  console.log(`Hostname: ${os.hostname()}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
