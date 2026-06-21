-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/agmxluavhloarapcmypy/sql

CREATE TABLE IF NOT EXISTS locations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id text NOT NULL,
  session_id integer,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy float,
  altitude float,
  speed float,
  heading float,
  source text DEFAULT 'unknown',  -- 'gps' | 'network' | 'ip'
  address text,
  city text,
  country text,
  captured_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS locations_device_id_idx ON locations(device_id);
CREATE INDEX IF NOT EXISTS locations_captured_at_idx ON locations(captured_at DESC);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='locations' AND policyname='anon_all_locations'
  ) THEN
    CREATE POLICY "anon_all_locations" ON locations FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
