ALTER TABLE users
  ADD COLUMN spotify_access_token TEXT NULL,
  ADD COLUMN spotify_refresh_token TEXT NULL,
  ADD COLUMN spotify_token_expiry BIGINT NULL;
