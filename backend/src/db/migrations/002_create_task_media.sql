-- task_media: one row per captured photo/video for a task.
-- Not part of the client's original schema (task_schema.xlsx only tracks a single
-- CLOUD_URL folder link on tasks_field) -- added so each of the 10 photos + 1 video,
-- its S3 key, capture direction and timestamp can be tracked and validated individually.
CREATE TABLE IF NOT EXISTS task_media (
    id                  BIGSERIAL PRIMARY KEY,
    task_id             BIGINT NOT NULL REFERENCES tasks_field (task_id) ON DELETE CASCADE,
    media_type          VARCHAR(5) NOT NULL CHECK (media_type IN ('photo', 'video')),
    sequence_number      SMALLINT NOT NULL, -- 1-10 for photos, 1 for the video
    s3_bucket           VARCHAR(63) NOT NULL,
    s3_key              VARCHAR(255) NOT NULL,
    s3_url              VARCHAR(500) NOT NULL,
    direction_degrees   NUMERIC(5, 1),
    direction_cardinal  VARCHAR(2), -- N, NE, E, SE, S, SW, W, NW
    captured_latitude   NUMERIC(10, 7),
    captured_longitude  NUMERIC(10, 7),
    captured_at         TIMESTAMPTZ NOT NULL,
    file_size_bytes     BIGINT,
    created_timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, media_type, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_task_media_task_id ON task_media (task_id);
