-- Create database if not exists (usually created by POSTGRES_DB env var)
-- This file runs automatically when container starts for the first time

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Create devices table
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default mobile device if not exists
INSERT INTO public.devices (id, name, description)
VALUES ('e2f89d1d-8265-45b8-a31d-298b7e5a4e70'::uuid, 'mobile', 'Mobile device for noise monitoring')
ON CONFLICT (name) DO NOTHING;

-- Create noise_spatial_table
CREATE TABLE IF NOT EXISTS public.noise_spatial_table (
    id SERIAL PRIMARY KEY,
    coordinate GEOMETRY(Point, 4326),
    noise_level DOUBLE PRECISION,
    time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    device_id UUID NOT NULL REFERENCES public.devices(id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_noise_coordinate ON public.noise_spatial_table USING GIST (coordinate);
CREATE INDEX IF NOT EXISTS idx_noise_device ON public.noise_spatial_table (device_id);
CREATE INDEX IF NOT EXISTS idx_noise_device_time ON public.noise_spatial_table (device_id, time);
CREATE INDEX IF NOT EXISTS idx_noise_time ON public.noise_spatial_table (time);
CREATE INDEX IF NOT EXISTS idx_noise_geom ON public.noise_spatial_table USING GIST (coordinate);
CREATE INDEX IF NOT EXISTS idx_noise_spatial_geom ON public.noise_spatial_table USING GIST (coordinate);

-- Create noise_laeq_hourly table (if needed)
CREATE TABLE IF NOT EXISTS public.noise_laeq_hourly (
    id SERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES public.devices(id),
    hour TIMESTAMP WITH TIME ZONE,
    laeq DOUBLE PRECISION,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

