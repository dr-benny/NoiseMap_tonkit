# 🎯 คำแนะนำ: คำนวณ LAeq ที่ GeoServer สำหรับหลายวัน

## 📋 ปัญหา

เมื่อต้องการดูข้อมูลหลายวัน (เช่น 7 วัน, 30 วัน):
- **Fetch ข้อมูลเยอะ**: 7 วัน × 1440 นาที = 10,080 records
- **คำนวณช้า**: คำนวณ LAeq ที่ฝั่ง client ใช้เวลานาน
- **Network หนัก**: Transfer ข้อมูลเยอะมาก

## ✅ วิธีแก้: คำนวณที่ GeoServer

### 1. สร้าง View หรือ Materialized View

```sql
-- สร้าง View สำหรับคำนวณ LAeq รายวัน
CREATE OR REPLACE VIEW noise_daily_laeq AS
SELECT 
    DATE(time) as date,
    device_id,
    ST_AsText(ST_Centroid(ST_Collect(coordinate))) as center_point,
    COUNT(*) as total_records,
    -- คำนวณ LAeq จากข้อมูลทั้งหมดในวันนั้น
    10 * LOG10(
        AVG(POWER(10.0, noise_level / 10.0))
    ) as laeq_daily,
    -- คำนวณ LAeq 1h (จาก 60 records ล่าสุด)
    (
        SELECT 10 * LOG10(
            AVG(POWER(10.0, n2.noise_level / 10.0))
        )
        FROM noise_spatial_table n2
        WHERE DATE(n2.time) = DATE(n.time)
        AND n2.device_id = n.device_id
        ORDER BY n2.time DESC
        LIMIT 60
    ) as laeq_1h,
    -- คำนวณ Lday (06:00 - 18:00)
    (
        SELECT 10 * LOG10(
            AVG(POWER(10.0, n3.noise_level / 10.0))
        )
        FROM noise_spatial_table n3
        WHERE DATE(n3.time) = DATE(n.time)
        AND n3.device_id = n.device_id
        AND EXTRACT(HOUR FROM n3.time) BETWEEN 6 AND 17
    ) as lday,
    -- คำนวณ Levening (18:00 - 22:00)
    (
        SELECT 10 * LOG10(
            AVG(POWER(10.0, n4.noise_level / 10.0))
        )
        FROM noise_spatial_table n4
        WHERE DATE(n4.time) = DATE(n.time)
        AND n4.device_id = n.device_id
        AND EXTRACT(HOUR FROM n4.time) BETWEEN 18 AND 21
    ) as levening,
    -- คำนวณ Lnight (22:00 - 06:00)
    (
        SELECT 10 * LOG10(
            AVG(POWER(10.0, n5.noise_level / 10.0))
        )
        FROM noise_spatial_table n5
        WHERE DATE(n5.time) = DATE(n.time)
        AND n5.device_id = n.device_id
        AND (EXTRACT(HOUR FROM n5.time) >= 22 OR EXTRACT(HOUR FROM n5.time) < 6)
    ) as lnight
FROM noise_spatial_table n
GROUP BY DATE(time), device_id;
```

### 2. สร้าง Materialized View (Performance ดีกว่า)

```sql
-- สร้าง Materialized View สำหรับ performance
CREATE MATERIALIZED VIEW noise_daily_laeq_mv AS
SELECT 
    DATE(time) as date,
    device_id,
    COUNT(*) as total_records,
    10 * LOG10(
        AVG(POWER(10.0, noise_level / 10.0))
    ) as laeq_daily,
    -- เพิ่ม indexes สำหรับ query เร็วขึ้น
    MIN(time) as first_record,
    MAX(time) as last_record
FROM noise_spatial_table
GROUP BY DATE(time), device_id;

-- สร้าง Index
CREATE INDEX idx_noise_daily_laeq_date ON noise_daily_laeq_mv(date);
CREATE INDEX idx_noise_daily_laeq_device ON noise_daily_laeq_mv(device_id);

-- Refresh Materialized View (รันทุกวัน)
REFRESH MATERIALIZED VIEW noise_daily_laeq_mv;
```

### 3. สร้าง Function สำหรับคำนวณ LAeq แบบ Dynamic

```sql
-- Function สำหรับคำนวณ LAeq ตามช่วงเวลา
CREATE OR REPLACE FUNCTION calculate_laeq(
    p_start_date TIMESTAMP,
    p_end_date TIMESTAMP,
    p_device_id UUID DEFAULT NULL,
    p_coordinate POINT DEFAULT NULL
)
RETURNS TABLE (
    laeq_daily NUMERIC,
    laeq_1h NUMERIC,
    lday NUMERIC,
    levening NUMERIC,
    lnight NUMERIC,
    total_records BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        -- LAeq Daily
        10 * LOG10(
            AVG(POWER(10.0, n.noise_level / 10.0))
        )::NUMERIC(10,2) as laeq_daily,
        -- LAeq 1h (60 records ล่าสุด)
        (
            SELECT 10 * LOG10(
                AVG(POWER(10.0, n2.noise_level / 10.0))
            )::NUMERIC(10,2)
            FROM noise_spatial_table n2
            WHERE n2.time BETWEEN p_start_date AND p_end_date
            AND (p_device_id IS NULL OR n2.device_id = p_device_id)
            AND (p_coordinate IS NULL OR ST_DWithin(n2.coordinate, p_coordinate, 0.001))
            ORDER BY n2.time DESC
            LIMIT 60
        ) as laeq_1h,
        -- Lday
        (
            SELECT 10 * LOG10(
                AVG(POWER(10.0, n3.noise_level / 10.0))
            )::NUMERIC(10,2)
            FROM noise_spatial_table n3
            WHERE n3.time BETWEEN p_start_date AND p_end_date
            AND (p_device_id IS NULL OR n3.device_id = p_device_id)
            AND (p_coordinate IS NULL OR ST_DWithin(n3.coordinate, p_coordinate, 0.001))
            AND EXTRACT(HOUR FROM n3.time) BETWEEN 6 AND 17
        ) as lday,
        -- Levening
        (
            SELECT 10 * LOG10(
                AVG(POWER(10.0, n4.noise_level / 10.0))
            )::NUMERIC(10,2)
            FROM noise_spatial_table n4
            WHERE n4.time BETWEEN p_start_date AND p_end_date
            AND (p_device_id IS NULL OR n4.device_id = p_device_id)
            AND (p_coordinate IS NULL OR ST_DWithin(n4.coordinate, p_coordinate, 0.001))
            AND EXTRACT(HOUR FROM n4.time) BETWEEN 18 AND 21
        ) as levening,
        -- Lnight
        (
            SELECT 10 * LOG10(
                AVG(POWER(10.0, n5.noise_level / 10.0))
            )::NUMERIC(10,2)
            FROM noise_spatial_table n5
            WHERE n5.time BETWEEN p_start_date AND p_end_date
            AND (p_device_id IS NULL OR n5.device_id = p_device_id)
            AND (p_coordinate IS NULL OR ST_DWithin(n5.coordinate, p_coordinate, 0.001))
            AND (EXTRACT(HOUR FROM n5.time) >= 22 OR EXTRACT(HOUR FROM n5.time) < 6)
        ) as lnight,
        COUNT(*)::BIGINT as total_records
    FROM noise_spatial_table n
    WHERE n.time BETWEEN p_start_date AND p_end_date
    AND (p_device_id IS NULL OR n.device_id = p_device_id)
    AND (p_coordinate IS NULL OR ST_DWithin(n.coordinate, p_coordinate, 0.001));
END;
$$ LANGUAGE plpgsql;
```

### 4. ใช้ใน GeoServer WFS

#### วิธีที่ 1: ใช้ View
```xml
<wfs:GetFeature service="WFS" version="1.1.0">
  <wfs:Query typeName="it.geosolutions:noise_daily_laeq">
    <ogc:Filter>
      <ogc:PropertyIsBetween>
        <ogc:PropertyName>date</ogc:PropertyName>
        <ogc:LowerBoundary>
          <ogc:Literal>2025-01-01</ogc:Literal>
        </ogc:LowerBoundary>
        <ogc:UpperBoundary>
          <ogc:Literal>2025-01-07</ogc:Literal>
        </ogc:UpperBoundary>
      </ogc:PropertyIsBetween>
    </ogc:Filter>
  </wfs:Query>
</wfs:GetFeature>
```

#### วิธีที่ 2: ใช้ SQL View ใน GeoServer
1. GeoServer → Data → SQL Views
2. สร้าง View ใหม่:
   ```sql
   SELECT 
       date,
       device_id,
       laeq_daily,
       laeq_1h,
       lday,
       levening,
       lnight
   FROM calculate_laeq(
       %start_date%::TIMESTAMP,
       %end_date%::TIMESTAMP,
       %device_id%::UUID
   )
   ```
3. ตั้งค่า parameters: `start_date`, `end_date`, `device_id`

### 5. เรียกใช้จาก Frontend

```typescript
// เรียกใช้ View ที่ GeoServer
const url = `http://localhost:8080/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=it.geosolutions:noise_daily_laeq&outputFormat=application/json&CQL_FILTER=date BETWEEN '2025-01-01' AND '2025-01-07'`;

fetch(url)
  .then(res => res.json())
  .then(data => {
    // ได้ข้อมูล LAeq ที่คำนวณแล้ว
    data.features.forEach(f => {
      console.log(f.properties.laeq_daily);
      console.log(f.properties.lday);
      console.log(f.properties.lnight);
    });
  });
```

## 📊 Performance Comparison

### วิธีเดิม (Client-side):
- **7 วัน**: 10,080 records → ~2-5 วินาที
- **30 วัน**: 43,200 records → ~10-20 วินาที
- **Network**: รับข้อมูลเยอะมาก

### วิธีใหม่ (GeoServer):
- **7 วัน**: 7 records → ~0.1-0.5 วินาที
- **30 วัน**: 30 records → ~0.2-0.8 วินาที
- **Network**: รับข้อมูลน้อยมาก

## 🎯 Benefits

✅ **Performance**: เร็วขึ้น 10-50 เท่า
✅ **Network**: ลดข้อมูล transfer 99%
✅ **Scalability**: รองรับหลายวันได้ง่าย
✅ **Server-side**: ใช้ database optimization
✅ **Caching**: Materialized View ใช้ได้ทันที

## 📝 Next Steps

1. ✅ สร้าง View/Materialized View ใน PostgreSQL
2. ✅ Publish เป็น Layer ใน GeoServer
3. ✅ แก้ไข Frontend ให้เรียกใช้ View แทน raw data
4. ✅ เพิ่ม Refresh Schedule สำหรับ Materialized View


