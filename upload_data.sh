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

# Check and install ogr2ogr if needed
if ! command -v ogr2ogr &> /dev/null; then
    echo "⚙️ ogr2ogr not found. Attempting to download and install GDAL for Windows..."
    
    # Create temporary directory for downloads
    TEMP_DIR="./temp_gdal_install"
    mkdir -p "$TEMP_DIR"
    
    # Download OSGeo4W network installer
    OSGEO4W_URL="https://download.osgeo.org/osgeo4w/v2/osgeo4w-setup.exe"
    INSTALLER_PATH="$TEMP_DIR/osgeo4w-setup.exe"
    
    echo "📥 Downloading OSGeo4W installer..."
    if command -v wget &> /dev/null; then
        wget -O "$INSTALLER_PATH" "$OSGEO4W_URL"
    elif command -v curl &> /dev/null; then
        curl -L -o "$INSTALLER_PATH" "$OSGEO4W_URL"
    else
        echo "❌ ERROR: Neither wget nor curl found."
        echo "Please install GDAL manually:"
        echo ""
        echo "1. Download OSGeo4W installer from: https://download.osgeo.org/osgeo4w/v2/osgeo4w-setup.exe"
        echo "2. Run the installer and select these packages:"
        echo "   - gdal"
        echo "   - libgdal"
        echo "3. Add OSGeo4W/bin to your system PATH"
        echo ""
        rm -rf "$TEMP_DIR"
        exit 1
    fi
    
    if [[ -f "$INSTALLER_PATH" ]]; then
        echo "✅ Download completed"
        echo ""
        echo "� Please follow these steps to install GDAL:"
        echo "1. Run the installer at: $INSTALLER_PATH"
        echo "2. Choose 'Express Desktop Install'"
        echo "3. Select these packages:"
        echo "   - gdal"
        echo "   - libgdal"
        echo "4. Complete the installation"
        echo "5. Add the following path to your system PATH:"
        echo "   C:\\OSGeo4W\\bin"
        echo ""
        echo "After installation:"
        echo "1. Close this terminal"
        echo "2. Open a new terminal"
        echo "3. Run this script again"
        echo ""
        exit 1
    else
        echo "❌ ERROR: Failed to download OSGeo4W installer"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
fi
    
    # Verify installation
    if command -v ogr2ogr &> /dev/null; then
        echo "✅ GDAL installed successfully"
    else
        echo "❌ ERROR: GDAL installation failed"
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
  
  echo "Running ogr2ogr with connection: host=$DB_HOST dbname=$DB_NAME user=$DB_USER port=$DB_PORT"
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

