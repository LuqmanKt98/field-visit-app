-- admin_users: not part of the client's original schema -- added to support the
-- admin login requirement ("ADMIN users should login and see all tasks").
CREATE TABLE IF NOT EXISTS admin_users (
    id                  BIGSERIAL PRIMARY KEY,
    username            VARCHAR(50) NOT NULL UNIQUE,
    email               VARCHAR(100) NOT NULL UNIQUE,
    password_hash       VARCHAR(100) NOT NULL,
    created_timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);
