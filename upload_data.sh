#!/bin/bash
set -euo pipefail

# === Vars ===
DB_NAME="${DB_NAME:-noisemap_tonkit_db}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_HOST="${DB_HOST:-NoiseMap_Tonkit_DB}"
DB_PORT="${DB_PORT:-5432}"
TABLE_NAME="noise_spatial_table"
DATA_URL="https://data.noise-planet.org/dump/Thailand.zip"
ZIP_FILE="${ZIP_FILE:-Thailand.zip}"
EXTRACT_DIR="${EXTRACT_DIR:-Thailand_data}"
DIRECTORY="${DIRECTORY:-${EXTRACT_DIR}}"     # โฟลเดอร์ไฟล์ *.points.geojson

export PGPASSWORD="$DB_PASSWORD"

echo "=========================================="
echo "  NoiseMap Tonkit - Data Upload Script"
echo "=========================================="
echo ""

# Check if ogr2ogr is installed
if ! command -v ogr2ogr &> /dev/null; then
    echo "❌ ERROR: ogr2ogr not found. Please install GDAL:"
    echo "   Ubuntu/Debian: sudo apt-get install gdal-bin"
    echo "   macOS: brew install gdal"
    exit 1
fi

# Check if unzip is installed
if ! command -v unzip &> /dev/null; then
    echo "❌ ERROR: unzip not found. Please install unzip"
    exit 1
fi

# 1) Download Thailand.zip if not exists
if [[ ! -f "$ZIP_FILE" ]]; then
    echo "📥 Downloading Thailand.zip from $DATA_URL..."
    if command -v wget &> /dev/null; then
        wget -O "$ZIP_FILE" "$DATA_URL" || {
            echo "⚠️  Download failed, continuing with existing files if any..."
        }
    elif command -v curl &> /dev/null; then
        curl -L -o "$ZIP_FILE" "$DATA_URL" || {
            echo "⚠️  Download failed, continuing with existing files if any..."
        }
    else
        echo "❌ ERROR: Neither wget nor curl found. Please install one of them."
        exit 1
    fi
    if [[ -f "$ZIP_FILE" ]]; then
        echo "✅ Download completed"
    fi
else
    echo "✅ Using existing $ZIP_FILE"
fi

# 2) Extract zip file
if [[ ! -d "$EXTRACT_DIR" ]]; then
    echo "📦 Extracting $ZIP_FILE..."
    unzip -q "$ZIP_FILE" -d "$EXTRACT_DIR"
    echo "✅ Extraction completed"
else
    echo "✅ Using existing $EXTRACT_DIR directory"
fi

# 3) Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
until psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -c '\q' 2>/dev/null; do
    echo "   Database not ready, waiting 2 seconds..."
    sleep 2
done
echo "✅ Database is ready"

# 4) ดึง UUID ของอุปกรณ์มือถือจากตาราง devices
echo "🔍 Getting device_id from database..."
DEVICE_ID=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -tA \
  -c "SELECT id FROM public.devices WHERE name='mobile' LIMIT 1;" 2>/dev/null || echo "")

if [[ -z "$DEVICE_ID" ]]; then
  echo "⚠️  Device 'mobile' not found. Creating default device..."
  DEVICE_ID=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -tA \
    -c "INSERT INTO public.devices (name, description) VALUES ('mobile', 'Mobile device for noise monitoring') ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id;")
  if [[ -z "$DEVICE_ID" ]]; then
    DEVICE_ID=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -tA \
      -c "SELECT id FROM public.devices WHERE name='mobile' LIMIT 1;")
  fi
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "❌ ERROR: ไม่สามารถสร้างหรือดึง device_id ได้"
  exit 1
fi

echo "✅ Using device_id = $DEVICE_ID (mobile)"

# 5) ตั้ง DEFAULT ให้ device_id ก่อน import (ภายใน transaction)
echo "⚙️  Setting default device_id..."
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
ALTER TABLE public.$TABLE_NAME ALTER COLUMN device_id SET DEFAULT '$DEVICE_ID'::uuid;
COMMIT;
SQL

# 6) Import ทุกไฟล์ GeoJSON (device_id จะถูกเติมอัตโนมัติด้วย DEFAULT)
echo ""
echo "📤 Importing GeoJSON files..."
FILE_COUNT=0
IMPORTED_COUNT=0

for FILE in "$DIRECTORY"/*.points.geojson; do
  [[ -e "$FILE" ]] || continue
  FILE_COUNT=$((FILE_COUNT + 1))
  echo "  [$FILE_COUNT] Uploading $(basename "$FILE")..."
  
  if ogr2ogr -f "PostgreSQL" \
    PG:"host=$DB_HOST dbname=$DB_NAME user=$DB_USER password=$DB_PASSWORD port=$DB_PORT" \
    "$FILE" \
    -nln "$TABLE_NAME" -append \
    -nlt POINT \
    -lco GEOMETRY_NAME=coordinate \
    -a_srs EPSG:4326 \
    -lco FID=id \
    -skipfailures 2>/dev/null; then
    IMPORTED_COUNT=$((IMPORTED_COUNT + 1))
    echo "     ✅ Success"
  else
    echo "     ⚠️  Failed (continuing...)"
  fi
done

if [[ $FILE_COUNT -eq 0 ]]; then
  echo "⚠️  No *.points.geojson files found in $DIRECTORY"
else
  echo "✅ Imported $IMPORTED_COUNT/$FILE_COUNT files"
fi

# 7) เอา DEFAULT ออก (กันพลาดในอนาคต)
echo "⚙️  Removing default device_id..."
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
ALTER TABLE public.$TABLE_NAME ALTER COLUMN device_id DROP DEFAULT;
COMMIT;
SQL

# 8) Show summary
echo ""
echo "=========================================="
echo "  Upload Summary"
echo "=========================================="
TOTAL_ROWS=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -tA \
  -c "SELECT COUNT(*) FROM public.$TABLE_NAME WHERE device_id='$DEVICE_ID'::uuid;" 2>/dev/null || echo "0")
echo "✅ Total rows imported: $TOTAL_ROWS"
echo "✅ Device ID used: $DEVICE_ID"
echo ""
echo "📋 Next step: Run create_hex_view.sh to create HEX view"
echo ""

