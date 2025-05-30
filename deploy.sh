#!/bin/bash

# Exit on error
set -e


# Configuration
EC2_HOST="ec2-user@35.154.27.171"
APP_DIR="/mediasoup-webrtc"

echo "Deploying to EC2 instance..."

# Build the Docker image locally
echo "Building Docker image..."
docker-compose -f docker-compose.prod.yml build

# Save the image
echo "Saving Docker image..."
docker save mediasoup-demo_app -o mediasoup-demo.tar

# Transfer files to EC2
echo "Transferring files to EC2..."
ssh $EC2_HOST "mkdir -p $APP_DIR"
scp mediasoup-demo.tar $EC2_HOST:$APP_DIR/
scp docker-compose.prod.yml $EC2_HOST:$APP_DIR/
scp -r ssl $EC2_HOST:$APP_DIR/

# On the EC2 instance
echo "Setting up EC2 instance..."
ssh $EC2_HOST "
    cd $APP_DIR
    
    # Load the Docker image
    echo 'Loading Docker image...'
    docker load -i mediasoup-demo.tar
    
    # Stop and remove existing container
    echo 'Stopping existing container...'
    docker-compose -f docker-compose.prod.yml down || true
    
    # Start the application
    echo 'Starting application...'
    docker-compose -f docker-compose.prod.yml up -d
    
    # Clean up
    echo 'Cleaning up...'
    rm mediasoup-demo.tar
"

echo "Deployment completed successfully!"