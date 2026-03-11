"""
Sample Python Application for ECS Fargate Spot Failover Testing

This application provides:
- Health check endpoint for NLB
- Status endpoint showing container metadata
- Simulated failure endpoint for testing failover
"""

import os
import socket
import platform
import signal
import sys
from datetime import datetime
from flask import Flask, jsonify

app = Flask(__name__)

PORT = int(os.environ.get('PORT', 8080))
SERVICE_NAME = os.environ.get('SERVICE_NAME', 'unknown')
CAPACITY_PROVIDER = os.environ.get('CAPACITY_PROVIDER', 'unknown')


def get_memory_info():
    """Get memory information (Linux only)"""
    try:
        with open('/proc/meminfo', 'r') as f:
            lines = f.readlines()
            mem_total = None
            mem_free = None
            for line in lines:
                if line.startswith('MemTotal:'):
                    mem_total = int(line.split()[1]) // 1024
                elif line.startswith('MemFree:'):
                    mem_free = int(line.split()[1]) // 1024
            return {
                'total': f'{mem_total}MB' if mem_total else 'unknown',
                'free': f'{mem_free}MB' if mem_free else 'unknown'
            }
    except:
        return {'total': 'unknown', 'free': 'unknown'}


@app.route('/health')
def health():
    """Health check endpoint for NLB"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'service': SERVICE_NAME,
        'capacityProvider': CAPACITY_PROVIDER
    })


@app.route('/')
def index():
    """Root endpoint"""
    return jsonify({
        'message': 'ECS Fargate Spot Failover Sample Application',
        'service': SERVICE_NAME,
        'capacityProvider': CAPACITY_PROVIDER,
        'hostname': socket.gethostname(),
        'timestamp': datetime.utcnow().isoformat(),
        'version': '1.0.0'
    })


@app.route('/status')
def status():
    """Status endpoint with detailed information"""
    memory = get_memory_info()
    return jsonify({
        'service': SERVICE_NAME,
        'capacityProvider': CAPACITY_PROVIDER,
        'hostname': socket.gethostname(),
        'platform': platform.system(),
        'arch': platform.machine(),
        'pythonVersion': platform.python_version(),
        'memory': memory,
        'timestamp': datetime.utcnow().isoformat()
    })


@app.route('/simulate-failure', methods=['POST'])
def simulate_failure():
    """Simulate failure endpoint (for testing failover)"""
    print('Simulating application failure...', flush=True)
    
    def shutdown():
        sys.exit(1)
    
    # Schedule shutdown after 5 seconds
    signal.signal(signal.SIGALRM, lambda signum, frame: shutdown())
    signal.alarm(5)
    
    return jsonify({
        'error': 'Simulated failure',
        'message': 'This is a test failure to trigger failover',
        'timestamp': datetime.utcnow().isoformat()
    }), 500


@app.route('/ready')
def ready():
    """Readiness probe endpoint"""
    return jsonify({
        'ready': True,
        'service': SERVICE_NAME,
        'timestamp': datetime.utcnow().isoformat()
    })


@app.route('/live')
def live():
    """Liveness probe endpoint"""
    return jsonify({
        'alive': True,
        'timestamp': datetime.utcnow().isoformat()
    })


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    print(f'Signal {signum} received, shutting down gracefully')
    sys.exit(0)


if __name__ == '__main__':
    # Register signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    print(f'Sample app starting on port {PORT}')
    print(f'Service: {SERVICE_NAME}')
    print(f'Capacity Provider: {CAPACITY_PROVIDER}')
    print(f'Hostname: {socket.gethostname()}')
    
    # Run with gunicorn in production, flask dev server for testing
    if os.environ.get('FLASK_ENV') == 'development':
        app.run(host='0.0.0.0', port=PORT, debug=True)
    else:
        import subprocess
        subprocess.run([
            'gunicorn', 
            '-w', '2',
            '-b', f'0.0.0.0:{PORT}',
            '--access-logfile', '-',
            '--error-logfile', '-',
            'server:app'
        ])
