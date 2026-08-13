-- Sample task for local development/testing.
-- Coordinates are MG Road, Bangalore -- the app is launching in India first, so
-- test data uses a real Indian address/PIN code rather than a US one.
INSERT INTO tasks_field (
    task_id, task_status, job_id, vendor_task_id, prop_full_addr, prop_city, prop_pin_cd,
    g_address, g_latitude, g_longitude, created_by, created_timestamp
) VALUES (
    345667896, 0, 'JOB-0001', 'VEND-0001', '1 MG Road', 'Bengaluru', '560001',
    'MG Road, Bengaluru, Karnataka, India', '12.9757', '77.6079', 'seed', now()
)
ON CONFLICT (task_id) DO NOTHING;
