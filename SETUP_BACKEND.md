# 🚀 Setup Backend สำหรับคำนวณ LAeq

## 📋 สิ่งที่ต้องทำ

### 1. ✅ สร้าง SQL Functions ใน PostgreSQL

รันไฟล์ `essential_SQL/SQL_LAeqCalculation.sql` ใน PostgreSQL:

```bash
psql -U postgres -d your_database -f essential_SQL/SQL_LAeqCalculation.sql
```

หรือใช้ pgAdmin:
1. เปิด pgAdmin
2. Connect ไปยัง database
3. เปิด SQL Query Tool
4. Copy-paste เนื้อหาจาก `SQL_LAeqCalculation.sql`
5. Execute

### 2. ✅ Functions ที่สร้าง

#### `calculate_laeq_by_type(date, lat, lng, type)`
- คำนวณ LAeq ตามประเภท (L24h, Lday, Levening, Lnight)
- Parameters:
  - `p_date`: วันที่ (DATE)
  - `p_lat`: ละติจูด (NUMERIC)
  - `p_lng`: ลองจิจูด (NUMERIC)
  - `p_type`: ประเภท ('L24h', 'Lday', 'Levening', 'Lnight')

#### `calculate_laeq_1h(date, lat, lng)`
- คำนวณ LAeq 1 ชั่วโมงล่าสุด
- Parameters:
  - `p_date`: วันที่ (DATE)
  - `p_lat`: ละติจูด (NUMERIC)
  - `p_lng`: ลองจิจูด (NUMERIC)

#### View: `noise_laeq_hourly`
- View สำหรับ LAeq รายชั่วโมง

### 3. ✅ Publish ใน GeoServer (Optional)

หากต้องการใช้ SQL View ใน GeoServer:

1. เปิด GeoServer: `http://localhost:8080/geoserver`
2. Login: admin/geoserver
3. ไปที่ **Data → Stores → Add new store → PostGIS**
4. สร้าง Store ใหม่:
   - **Workspace**: it.geosolutions
   - **Database**: postgres
   - **Host**: localhost
   - **Port**: 5432
   - **Username**: postgres
   - **Password**: @Ben031048!
5. **Publish Layer**:
   - เลือก View: `noise_laeq_hourly`
   - ตั้งชื่อ: `noise_laeq_hourly`

### 4. ✅ API Route

API Route ถูกสร้างแล้วที่ `app/api/laeq-backend/route.ts`

**Endpoint**: `POST /api/laeq-backend`

**Request Body**:
```json
{
  "date": "2025-01-15",
  "lat": 13.756111,
  "lng": 100.516667,
  "type": "L1h" | "L24h" | "Lday" | "Levening" | "Lnight"
}
```

**Response**:
```json
{
  "laeq": 65.3,
  "totalRecords": 1440,
  "min": 40.5,
  "max": 75.2,
  "avg": 65.3,
  "trendData": [
    {"hour": 0, "laeq": 45.2, "count": 60},
    ...
  ],
  "type": "L24h",
  "date": "2025-01-15"
}
```

### 5. ✅ วิธีทดสอบ

#### ทดสอบ SQL Functions:
```sql
-- ทดสอบ LAeq 1h
SELECT * FROM calculate_laeq_1h('2025-01-15', 13.756111, 100.516667);

-- ทดสอบ LAeq 24h
SELECT * FROM calculate_laeq_by_type('2025-01-15', 13.756111, 100.516667, 'L24h');

-- ทดสอบ Lday
SELECT * FROM calculate_laeq_by_type('2025-01-15', 13.756111, 100.516667, 'Lday');

-- ทดสอบ Lnight
SELECT * FROM calculate_laeq_by_type('2025-01-15', 13.756111, 100.516667, 'Lnight');
```

#### ทดสอบ API:
```bash
curl -X POST http://localhost:3000/api/laeq-backend \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2025-01-15",
    "lat": 13.756111,
    "lng": 100.516667,
    "type": "L1h"
  }'
```

### 6. ✅ Indexes

SQL script จะสร้าง indexes อัตโนมัติ:
- `idx_noise_time`: Index on time column
- `idx_noise_coordinate`: GIST index on coordinate (spatial)
- `idx_noise_date`: Index on DATE(time)

### 7. ✅ Performance Tips

1. **Materialized View** (Optional): สำหรับข้อมูลที่ query บ่อย
   ```sql
   CREATE MATERIALIZED VIEW noise_laeq_daily_mv AS
   SELECT * FROM noise_laeq_hourly;
   
   CREATE INDEX ON noise_laeq_daily_mv(date, hour);
   ```

2. **Refresh Schedule**: รันทุกวัน
   ```sql
   REFRESH MATERIALIZED VIEW noise_laeq_daily_mv;
   ```

### 8. ✅ Troubleshooting

#### Error: Function not found
- ตรวจสอบว่า SQL script รันสำเร็จ
- ตรวจสอบว่า function อยู่ใน schema ที่ถูกต้อง

#### Error: Permission denied
- ตรวจสอบว่า user postgres มีสิทธิ์ execute function
- Grant permission: `GRANT EXECUTE ON FUNCTION calculate_laeq_by_type TO postgres;`

#### Error: No data returned
- ตรวจสอบว่ามีข้อมูลในวันที่เลือก
- ตรวจสอบว่า coordinate ถูกต้อง
- ตรวจสอบ tolerance (0.001 = ~100 meters)

### 9. ✅ Next Steps

1. ✅ รัน SQL script
2. ✅ ทดสอบ functions
3. ✅ ทดสอบ API
4. ✅ ใช้ใน Frontend

## 🎉 เสร็จสิ้น!

ตอนนี้ระบบพร้อมใช้งานแล้ว! 🚀

