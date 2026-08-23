-- Admins are created by an operator running `npm run create-admin`, which means the
-- initial password is known to whoever set it up. Flagging the account forces a change
-- on first login, so that shared secret cannot persist.
ALTER TABLE admin_users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;

-- Existing accounts were created with operator-set passwords, so require a change.
UPDATE admin_users SET must_change_password = true WHERE password_changed_at IS NULL;
