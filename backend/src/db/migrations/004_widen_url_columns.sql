-- Deviation from the client-supplied task_schema.xlsx, which specified
-- VARCHAR(75) for the URL columns.
--
-- A real S3 folder URL does not fit in 75 characters. For example:
--   https://assetlookout-field-visit-media.s3.ap-south-1.amazonaws.com/345667896/
-- is 77 characters, and that is with a fairly short bucket name -- writing it
-- failed with "value too long for type character varying(75)" (SQLSTATE 22001)
-- on the very first photo upload.
--
-- Widening a varchar is non-destructive (no data is rewritten or truncated), so
-- this is safe to apply to an existing table. WEB_URL and FOLDER_URL are widened
-- alongside CLOUD_URL because they are the same class of column and would hit the
-- same limit as soon as they are populated with real URLs.
ALTER TABLE tasks_field ALTER COLUMN cloud_url  TYPE VARCHAR(500);
ALTER TABLE tasks_field ALTER COLUMN folder_url TYPE VARCHAR(500);
ALTER TABLE tasks_field ALTER COLUMN web_url    TYPE VARCHAR(500);
