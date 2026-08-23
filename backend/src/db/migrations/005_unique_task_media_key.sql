-- Defence in depth for the "completed means the files exist" guarantee.
--
-- /media/confirm previously accepted a caller-supplied S3 key and only checked its
-- prefix, so one uploaded photo could be confirmed under all ten sequence numbers
-- (and again as the video) -- marking the task Completed with a single object in the
-- bucket. The route now derives the key itself, which fixes the hole; this constraint
-- makes the invariant impossible to violate again from any future code path.
--
-- Existing rows may already contain duplicates from that behaviour, so clear them out
-- first: those rows never corresponded to distinct uploads.
DELETE FROM task_media a
USING task_media b
WHERE a.task_id = b.task_id
  AND a.s3_key = b.s3_key
  AND a.id > b.id;

ALTER TABLE task_media
    ADD CONSTRAINT task_media_task_id_s3_key_key UNIQUE (task_id, s3_key);
