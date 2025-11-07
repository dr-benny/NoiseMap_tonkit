#!/bin/bash

# Script สำหรับ Deploy บน EC2 เมื่อ GeoServer อยู่คนละ Docker network

echo "=========================================="
echo "  Deploying NoiseMap on EC2"
echo "=========================================="
echo ""

# 1. หา Private IP ของ EC2 instance
EC2_PRIVATE_IP=$(hostname -I | awk '{print $1}')
echo "📍 EC2 Private IP: $EC2_PRIVATE_IP"

# 2. หา Public IP (ถ้ามี)
EC2_PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "N/A")
echo "📍 EC2 Public IP: $EC2_PUBLIC_IP"

# 3. ตรวจสอบว่า GeoServer ทำงานอยู่หรือไม่
echo ""
echo "🔍 Checking GeoServer connection..."
if curl -s --connect-timeout 5 "http://${EC2_PRIVATE_IP}:8080/geoserver/wfs?service=WFS&version=1.0.0&request=GetCapabilities" > /dev/null 2>&1; then
    echo "✅ GeoServer is accessible at http://${EC2_PRIVATE_IP}:8080"
    GEOSERVER_URL="http://${EC2_PRIVATE_IP}:8080"
elif [ "$EC2_PUBLIC_IP" != "N/A" ] && curl -s --connect-timeout 5 "http://${EC2_PUBLIC_IP}:8080/geoserver/wfs?service=WFS&version=1.0.0&request=GetCapabilities" > /dev/null 2>&1; then
    echo "✅ GeoServer is accessible at http://${EC2_PUBLIC_IP}:8080"
    GEOSERVER_URL="http://${EC2_PUBLIC_IP}:8080"
else
    echo "⚠️  Warning: Cannot connect to GeoServer automatically"
    echo "   Please set GEOSERVER_URL manually"
    read -p "Enter GeoServer URL (e.g., http://172.31.14.245:8080): " GEOSERVER_URL
    if [ -z "$GEOSERVER_URL" ]; then
        echo "❌ GEOSERVER_URL is required. Exiting..."
        exit 1
    fi
fi

# 4. หา Gateway IP (ถ้ามี gis-net network)
GATEWAY_IP=$(docker network inspect gis-net --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || echo "172.23.0.1")
echo "📍 Docker Gateway IP: $GATEWAY_IP"

# 5. Pull latest image
echo ""
echo "📥 Pulling latest image..."
docker pull bennyeiei555/noisemap-tonkit:latest

# 6. Stop and remove existing container (ถ้ามี)
echo ""
echo "🛑 Stopping existing container (if any)..."
docker stop noisemap-tonkit 2>/dev/null || true
docker rm noisemap-tonkit 2>/dev/null || true

# 7. Run new container
echo ""
echo "🚀 Starting container..."
docker run -d \
  --name noisemap-tonkit \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e GEOSERVER_URL="${GEOSERVER_URL}" \
  -e GEOSERVER_USER="${GEOSERVER_USER:-admin}" \
  -e GEOSERVER_PASSWORD="${GEOSERVER_PASSWORD:-geoserver}" \
  -e DOCKER_HOST_IP="${GATEWAY_IP}" \
  -e NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}" \
  -e NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN="${NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN:-}" \
  --add-host=host.docker.internal:host-gateway \
  --restart unless-stopped \
  bennyeiei555/noisemap-tonkit:latest

# 8. ตรวจสอบสถานะ
echo ""
echo "⏳ Waiting for container to start..."
sleep 5

if docker ps | grep -q noisemap-tonkit; then
    echo "✅ Container started successfully!"
    echo ""
    echo "📊 Container Status:"
    docker ps | grep noisemap-tonkit
    echo ""
    echo "📝 Environment Variables:"
    docker exec noisemap-tonkit env | grep -E "GEOSERVER|NODE_ENV|DOCKER_HOST" | sort
    echo ""
    echo "🌐 Application is available at: http://${EC2_PUBLIC_IP:-$EC2_PRIVATE_IP}:3000"
    echo ""
    echo "📋 To view logs: docker logs -f noisemap-tonkit"
else
    echo "❌ Container failed to start!"
    echo "📋 Check logs: docker logs noisemap-tonkit"
    exit 1
fi

