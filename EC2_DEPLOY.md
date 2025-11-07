# คำแนะนำการ Deploy บน EC2

## Environment Variables ที่ต้องตั้งค่า

### 1. GeoServer URL (สำคัญ!)

**ถ้า GeoServer อยู่ใน Docker network เดียวกัน (`gis-net`):**
```bash
# ไม่ต้องตั้งค่า (ใช้ default: http://geoserver:8080)
```

**ถ้า GeoServer อยู่บน EC2 host (ไม่ใช่ใน Docker):**
```bash
# ใช้ private IP ของ EC2 instance
GEOSERVER_URL=http://172.31.14.245:8080

# หรือใช้ public IP (ถ้า GeoServer expose ออกมา)
GEOSERVER_URL=http://YOUR_EC2_PUBLIC_IP:8080

# หรือใช้ domain name
GEOSERVER_URL=http://geoserver.yourdomain.com:8080
```

**วิธีหา IP:**
```bash
# Private IP
hostname -I | awk '{print $1}'

# Public IP
curl http://169.254.169.254/latest/meta-data/public-ipv4
```

### 2. AI Service (ถ้าใช้)
```bash
# Gateway IP ของ Docker network (หาได้จาก container)
DOCKER_HOST_IP=172.23.0.1
```

### 3. API Keys (ถ้าใช้)
```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_key_here
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_token_here
```

## วิธี Deploy

### วิธีที่ 1: Docker Run (แนะนำ)

```bash
# 1. Pull image
docker pull bennyeiei555/noisemap-tonkit:latest

# 2. หา Gateway IP (ถ้าต้องการ)
docker network inspect gis-net | grep Gateway

# 3. Run container
docker run -d \
  --name noisemap-tonkit \
  --network gis-net \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e GEOSERVER_URL=http://YOUR_GEOSERVER_IP:8080 \
  -e DOCKER_HOST_IP=172.23.0.1 \
  --add-host=host.docker.internal:host-gateway \
  --restart unless-stopped \
  bennyeiei555/noisemap-tonkit:latest
```

**ตัวอย่าง:**
```bash
# ถ้า GeoServer อยู่บน EC2 ที่ private IP = 172.31.14.245
docker run -d \
  --name noisemap-tonkit \
  --network gis-net \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e GEOSERVER_URL=http://172.31.14.245:8080 \
  -e DOCKER_HOST_IP=172.23.0.1 \
  --add-host=host.docker.internal:host-gateway \
  --restart unless-stopped \
  bennyeiei555/noisemap-tonkit:latest
```

### วิธีที่ 2: Docker Compose

สร้างไฟล์ `docker-compose.ec2.yml`:

```yaml
version: '3.8'

services:
  noisemap:
    image: bennyeiei555/noisemap-tonkit:latest
    container_name: noisemap-tonkit
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - GEOSERVER_URL=http://172.31.14.245:8080  # เปลี่ยนเป็น IP ของ GeoServer
      - DOCKER_HOST_IP=172.23.0.1
      - NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}
      - NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=${NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN:-}
    networks:
      - gis-net
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  gis-net:
    external: true
```

รัน:
```bash
docker-compose -f docker-compose.ec2.yml up -d
```

### วิธีที่ 3: ใช้ .env file

สร้างไฟล์ `.env`:
```bash
NODE_ENV=production
GEOSERVER_URL=http://172.31.14.245:8080
DOCKER_HOST_IP=172.23.0.1
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_key_here
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_token_here
```

รัน:
```bash
docker run -d \
  --name noisemap-tonkit \
  --network gis-net \
  -p 3000:3000 \
  --env-file .env \
  --add-host=host.docker.internal:host-gateway \
  --restart unless-stopped \
  bennyeiei555/noisemap-tonkit:latest
```

## ตรวจสอบการตั้งค่า

### 1. ตรวจสอบ Environment Variables
```bash
docker exec noisemap-tonkit env | grep -E "GEOSERVER|NODE_ENV"
```

### 2. ตรวจสอบการเชื่อมต่อ GeoServer
```bash
# จาก container
docker exec noisemap-tonkit wget -qO- --timeout=5 "http://YOUR_GEOSERVER_IP:8080/geoserver/wfs?service=WFS&version=1.0.0&request=GetCapabilities" | head -5

# หรือจาก host
curl "http://YOUR_GEOSERVER_IP:8080/geoserver/wfs?service=WFS&version=1.0.0&request=GetCapabilities" | head -5
```

### 3. ตรวจสอบ Logs
```bash
docker logs noisemap-tonkit | grep -i geoserver
```

## สถานการณ์ต่างๆ

### สถานการณ์ 1: GeoServer อยู่ใน Docker network เดียวกัน
```bash
# ไม่ต้องตั้งค่า GEOSERVER_URL
# ใช้ default: http://geoserver:8080
docker run -d \
  --name noisemap-tonkit \
  --network gis-net \
  -p 3000:3000 \
  -e NODE_ENV=production \
  bennyeiei555/noisemap-tonkit:latest
```

### สถานการณ์ 2: GeoServer อยู่บน EC2 host (port 8080)
```bash
# ใช้ private IP
docker run -d \
  --name noisemap-tonkit \
  --network gis-net \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e GEOSERVER_URL=http://172.31.14.245:8080 \
  bennyeiei555/noisemap-tonkit:latest
```

### สถานการณ์ 3: GeoServer อยู่บน server อื่น
```bash
# ใช้ public IP หรือ domain
docker run -d \
  --name noisemap-tonkit \
  --network gis-net \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e GEOSERVER_URL=http://geoserver.example.com:8080 \
  bennyeiei555/noisemap-tonkit:latest
```

## Troubleshooting

### ปัญหา: ไม่สามารถเชื่อมต่อ GeoServer ได้
1. **ตรวจสอบ IP/URL:**
   ```bash
   docker exec noisemap-tonkit ping -c 2 YOUR_GEOSERVER_IP
   ```

2. **ตรวจสอบ Port:**
   ```bash
   telnet YOUR_GEOSERVER_IP 8080
   ```

3. **ตรวจสอบ Firewall:**
   ```bash
   sudo ufw status
   # ถ้าต้องการเปิด port 8080
   sudo ufw allow 8080/tcp
   ```

4. **ตรวจสอบ Security Group (EC2):**
   - เปิด inbound rule สำหรับ port 8080
   - Source: 0.0.0.0/0 หรือ IP ของ container network

### ปัญหา: Container ไม่เห็น GeoServer
- **ตรวจสอบ Network:**
  ```bash
  docker network inspect gis-net
  ```
- **ตรวจสอบว่า GeoServer container อยู่ใน network เดียวกัน:**
  ```bash
  docker network inspect gis-net | grep geoserver
  ```

## ตัวอย่างคำสั่งสำหรับ EC2

```bash
# 1. หา Private IP ของ EC2
EC2_PRIVATE_IP=$(hostname -I | awk '{print $1}')
echo "EC2 Private IP: $EC2_PRIVATE_IP"

# 2. หา Gateway IP ของ Docker network
GATEWAY_IP=$(docker network inspect gis-net --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}')
echo "Gateway IP: $GATEWAY_IP"

# 3. Run container
docker run -d \
  --name noisemap-tonkit \
  --network gis-net \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e GEOSERVER_URL=http://${EC2_PRIVATE_IP}:8080 \
  -e DOCKER_HOST_IP=${GATEWAY_IP} \
  --add-host=host.docker.internal:host-gateway \
  --restart unless-stopped \
  bennyeiei555/noisemap-tonkit:latest
```

