#!/bin/bash

# Docker Run Script for NoiseMap Tonkit
# Usage: ./docker-run.sh

echo "=========================================="
echo "  NoiseMap Tonkit - Docker Run Script"
echo "=========================================="
echo ""

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^noisemap-tonkit$"; then
  echo "⚠️  Container 'noisemap-tonkit' already exists!"
  read -p "Do you want to remove it and create a new one? (y/n): " answer
  if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    echo "Stopping and removing existing container..."
    docker stop noisemap-tonkit 2>/dev/null
    docker rm noisemap-tonkit 2>/dev/null
  else
    echo "Exiting..."
    exit 1
  fi
fi

# Check if image exists
if ! docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^noisemap-tonkit:latest$"; then
  echo "📦 Image 'noisemap-tonkit' not found. Building..."
  docker build -t noisemap-tonkit .
  if [ $? -ne 0 ]; then
    echo "❌ Build failed! Exiting..."
    exit 1
  fi
  echo "✅ Build completed!"
  echo ""
fi

# Get API keys from user
echo "Please enter your API keys (press Enter to skip):"
echo ""

read -p "Google Maps API Key (optional): " GOOGLE_KEY
read -p "Mapbox Access Token (optional): " MAPBOX_TOKEN

echo ""
echo "Starting container..."

# Build docker run command
DOCKER_CMD="docker run -d --name noisemap-tonkit -p 3000:3000 -e NODE_ENV=production"

# Add API keys if provided
if [ -n "$GOOGLE_KEY" ]; then
  DOCKER_CMD="$DOCKER_CMD -e NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=\"$GOOGLE_KEY\""
fi

if [ -n "$MAPBOX_TOKEN" ]; then
  DOCKER_CMD="$DOCKER_CMD -e NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=\"$MAPBOX_TOKEN\""
fi

DOCKER_CMD="$DOCKER_CMD --restart unless-stopped noisemap-tonkit"

# Execute the command
eval $DOCKER_CMD

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Container started successfully!"
  echo ""
  echo "🌐 Access the application at: http://localhost:3000"
  echo ""
  echo "📋 Useful commands:"
  echo "   View logs:    docker logs -f noisemap-tonkit"
  echo "   Stop:         docker stop noisemap-tonkit"
  echo "   Start:        docker start noisemap-tonkit"
  echo "   Remove:       docker rm -f noisemap-tonkit"
else
  echo ""
  echo "❌ Failed to start container!"
  exit 1
fi

