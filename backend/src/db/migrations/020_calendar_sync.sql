ALTER TABLE academic_countdowns
  ADD COLUMN google_event_id VARCHAR(255) NULL,
  ADD COLUMN source VARCHAR(50) NULL DEFAULT 'local';
