# Database Setup Guide

## Quick Start

### 1. Start Database

```bash
# Make sure gis-net network exists
docker network create gis-net 2>/dev/null || true

# Start database
docker-compose -f docker-compose.db.yml up -d
```

### 2. Upload Data

```bash
# This will:
# - Download Thailand.zip from https://data.noise-planet.org/dump/Thailand.zip
# - Extract and upload all *.points.geojson files to database
# - Automatically get device_id from devices table
./upload_data.sh
```

### 3. Create HEX View

```bash
# This will:
# - Read device_id from database (devices table where name='mobile')
# - Create HEX view with calculated LAeq values
./create_hex_view.sh
```

## Database Structure

### Tables

- **devices**: Stores device information
  - `id` (UUID): Primary key
  - `name` (VARCHAR): Device name (e.g., 'mobile')
  - `description` (TEXT): Device description

- **noise_spatial_table**: Stores noise measurement points
  - `id` (SERIAL): Primary key
  - `coordinate` (GEOMETRY Point, 4326): GPS coordinates
  - `noise_level` (DOUBLE PRECISION): Noise level in dB
  - `time` (TIMESTAMP WITH TIME ZONE): Measurement timestamp
  - `device_id` (UUID): Foreign key to devices table

### Views

- **hex_005_e2f8**: HEX grid view with LAeq calculations
  - `hex_id`: Hexagon ID
  - `geom`: Hexagon geometry
  - `n`: Number of points in hexagon
  - `t_min`: Minimum timestamp
  - `t_max`: Maximum timestamp
  - `laeq`: Calculated LAeq value

## Environment Variables

You can override database connection settings:

```bash
export DB_HOST=NoiseMap_Tonkit_DB
export DB_PORT=5432
export DB_NAME=noisemap_tonkit_db
export DB_USER=postgres
export DB_PASSWORD=postgres
```

## Manual Database Access

```bash
# Connect to database
docker exec -it NoiseMap_Tonkit_DB psql -U postgres -d noisemap_tonkit_db

# Or from host
psql -h localhost -U postgres -d noisemap_tonkit_db
```

## Troubleshooting

### Database not accessible
- Check if container is running: `docker ps | grep NoiseMap_Tonkit_DB`
- Check network: `docker network inspect gis-net`
- Check logs: `docker logs NoiseMap_Tonkit_DB`

### Upload fails
- Make sure GDAL is installed: `ogr2ogr --version`
- Check if Thailand.zip is downloaded
- Verify database connection: `psql -h NoiseMap_Tonkit_DB -U postgres -d noisemap_tonkit_db -c '\q'`

### HEX view not created
- Make sure data is uploaded first
- Check if device exists: `SELECT * FROM devices WHERE name='mobile';`
- Verify data exists: `SELECT COUNT(*) FROM noise_spatial_table;`

