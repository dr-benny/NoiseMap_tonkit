#!/bin/bash
set -euo pipefail

# === Vars ===
DB_NAME="noisemap_tonkit_db"
DB_USER="postgres"
DB_PASSWORD="postgres"
DB_HOST="${DB_HOST:-NoiseMap_Tonkit_DB}"
DB_PORT="5432"
VIEW_NAME="hex_005_e2f8"
HEX_SIZE="0.05"

export PGPASSWORD="$DB_PASSWORD"

echo "=========================================="
echo "  Create HEX View Script"
echo "=========================================="
echo ""

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
until psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -c '\q' 2>/dev/null; do
    echo "   Database not ready, waiting 2 seconds..."
    sleep 2
done
echo "✅ Database is ready"

# Get device_id from database
echo "🔍 Getting device_id from database..."
DEVICE_ID=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -tA \
  -c "SELECT id FROM public.devices WHERE name='mobile' LIMIT 1;" 2>/dev/null || echo "")

if [[ -z "$DEVICE_ID" ]]; then
  echo "❌ ERROR: ไม่พบ device 'mobile' ใน database"
  echo "   Please run upload_data.sh first to create the device"
  exit 1
fi

echo "✅ Using device_id = $DEVICE_ID"

# Check if data exists
DATA_COUNT=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -tA \
  -c "SELECT COUNT(*) FROM public.noise_spatial_table WHERE device_id='$DEVICE_ID'::uuid;" 2>/dev/null || echo "0")

if [[ "$DATA_COUNT" -eq "0" ]]; then
  echo "⚠️  WARNING: No data found for device_id = $DEVICE_ID"
  echo "   Please run upload_data.sh first to import data"
  exit 1
fi

echo "✅ Found $DATA_COUNT records for this device"

# Create HEX view
echo ""
echo "🔨 Creating HEX view: $VIEW_NAME"
echo "   Hex size: $HEX_SIZE"
echo "   Device ID: $DEVICE_ID"
echo ""

psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -v ON_ERROR_STOP=1 <<SQL
-- Drop view if exists
DROP VIEW IF EXISTS public.$VIEW_NAME CASCADE;

-- Create HEX view
CREATE OR REPLACE VIEW public.$VIEW_NAME AS
WITH bounds AS (
    SELECT 
        st_extent(noise_spatial_table.coordinate)::geometry AS g
    FROM noise_spatial_table
    WHERE noise_spatial_table.device_id = '$DEVICE_ID'::uuid
), 
grid AS (
    SELECT 
        st_setsrid((st_hexagongrid($HEX_SIZE::double precision, bounds.g)).geom, 4326) AS geom
    FROM bounds
)
SELECT 
    row_number() OVER () AS hex_id,
    g.geom,
    count(n.*) AS n,
    min(n."time") AS t_min,
    max(n."time") AS t_max,
    10::numeric * (
        ln(avg(power(10.0::double precision, n.noise_level / 10.0::double precision))) 
        / ln(10.0)::double precision
    )::numeric(10,2) AS laeq
FROM grid g
LEFT JOIN noise_spatial_table n 
    ON n.device_id = '$DEVICE_ID'::uuid
   AND st_intersects(g.geom, n.coordinate)
GROUP BY g.geom;

-- Create index on geometry
CREATE INDEX IF NOT EXISTS idx_${VIEW_NAME}_geom ON public.$VIEW_NAME USING GIST (geom);

-- Create centroid view
DROP VIEW IF EXISTS public.${VIEW_NAME}_centroid CASCADE;

CREATE OR REPLACE VIEW public.${VIEW_NAME}_centroid AS
SELECT 
    hex_id,
    ST_Centroid(geom) AS geom,
    n,
    t_min,
    t_max,
    laeq
FROM public.$VIEW_NAME;

SQL

if [[ $? -eq 0 ]]; then
    echo "✅ HEX view created successfully!"
    echo ""
    
    # Show summary
    HEX_COUNT=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -tA \
      -c "SELECT COUNT(*) FROM public.$VIEW_NAME;" 2>/dev/null || echo "0")
    
    echo "=========================================="
    echo "  HEX View Summary"
    echo "=========================================="
    echo "✅ View name: $VIEW_NAME"
    echo "✅ Total hexagons: $HEX_COUNT"
    echo "✅ Device ID: $DEVICE_ID"
    echo ""
    echo "📋 You can now use this view in GeoServer"
else
    echo "❌ ERROR: Failed to create HEX view"
    exit 1
fi

