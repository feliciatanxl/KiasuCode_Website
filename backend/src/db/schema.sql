CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) NOT NULL,
  provider ENUM('google', 'telegram', 'local') NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL,
  password_hash VARCHAR(255) NULL,
  name VARCHAR(160) NOT NULL,
  photo_url LONGTEXT NULL,
  public_key LONGTEXT NULL,
  wrapped_private_key LONGTEXT NULL,
  has_consented BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_chat_id VARCHAR(255) NULL,
  google_id VARCHAR(255) NULL,
  session_version INT NOT NULL DEFAULT 1,
  spotify_access_token TEXT NULL,
  spotify_refresh_token TEXT NULL,
  spotify_token_expiry BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_provider_id (provider_id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_name (name),
  UNIQUE KEY uq_users_telegram_chat_id (telegram_chat_id),
  UNIQUE KEY uq_users_google_id (google_id)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS password_history (
  id CHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_password_history_user_created (user_id, created_at),
  CONSTRAINT fk_password_history_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS institutions (
  id CHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_institutions_user_name (user_id, name),
  CONSTRAINT fk_institutions_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS semesters (
  id CHAR(36) NOT NULL,
  institution_id CHAR(36) NOT NULL,
  academic_year VARCHAR(9) NOT NULL,
  term VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_semesters_institution_period (
    institution_id,
    academic_year,
    term
  ),
  CONSTRAINT chk_semesters_academic_year
    CHECK (academic_year REGEXP '^AY[0-9]{2}/[0-9]{2}$'),
  CONSTRAINT fk_semesters_institution
    FOREIGN KEY (institution_id) REFERENCES institutions (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS modules (
  id CHAR(36) NOT NULL,
  semester_id CHAR(36) NOT NULL,
  module_code VARCHAR(24) NOT NULL,
  module_name VARCHAR(180) NOT NULL,
  credits DECIMAL(4, 1) UNSIGNED NOT NULL,
  target_grade VARCHAR(10) NOT NULL,
  actual_grade VARCHAR(10) NULL,
  status ENUM('Backlog', 'In Progress', 'Merged') NOT NULL DEFAULT 'Backlog',
  PRIMARY KEY (id),
  UNIQUE KEY uq_modules_semester_code (semester_id, module_code),
  CONSTRAINT chk_modules_credits CHECK (credits > 0),
  CONSTRAINT fk_modules_semester
    FOREIGN KEY (semester_id) REFERENCES semesters (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS study_sessions (
  id CHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  module_id CHAR(36) NULL,
  custom_category VARCHAR(255) NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_study_sessions_user_created (user_id, created_at),
  KEY idx_study_sessions_module (module_id),
  CONSTRAINT chk_study_sessions_duration
    CHECK (duration_minutes BETWEEN 1 AND 480),
  CONSTRAINT fk_study_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_study_sessions_module
    FOREIGN KEY (module_id) REFERENCES modules (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_wallets (
  user_id VARCHAR(36) NOT NULL,
  coins_balance BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_wallets_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS pets (
  id CHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  hunger_level TINYINT UNSIGNED NOT NULL DEFAULT 100,
  happiness_level TINYINT UNSIGNED NOT NULL DEFAULT 100,
  last_interacted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pets_user (user_id),
  CONSTRAINT chk_pets_hunger CHECK (hunger_level BETWEEN 0 AND 100),
  CONSTRAINT chk_pets_happiness CHECK (happiness_level BETWEEN 0 AND 100),
  CONSTRAINT fk_pets_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS academic_countdowns (
  id CHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  module_id CHAR(36) NULL,
  title VARCHAR(255) NOT NULL,
  target_date DATETIME NOT NULL,
  category VARCHAR(50) NOT NULL,
  color VARCHAR(30) DEFAULT 'bg-blue-500',
  is_annual BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_academic_countdowns_user_target (user_id, target_date),
  KEY idx_academic_countdowns_module (module_id),
  CONSTRAINT fk_academic_countdowns_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_academic_countdowns_module
    FOREIGN KEY (module_id) REFERENCES modules (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS module_files (
  id CHAR(36) NOT NULL,
  module_id CHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(1024) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_module_files_module (module_id),
  KEY idx_module_files_user (user_id),
  CONSTRAINT fk_module_files_module
    FOREIGN KEY (module_id) REFERENCES modules (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_module_files_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS friendships (
  id CHAR(36) NOT NULL,
  requester_id VARCHAR(36) NOT NULL,
  addressee_id VARCHAR(36) NOT NULL,
  status ENUM('Pending', 'Accepted') NOT NULL DEFAULT 'Pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_friendships_pair (requester_id, addressee_id),
  KEY idx_friendships_addressee (addressee_id),
  CONSTRAINT fk_friendships_requester
    FOREIGN KEY (requester_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_friendships_addressee
    FOREIGN KEY (addressee_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS private_messages (
  id CHAR(36) NOT NULL,
  sender_id VARCHAR(36) NOT NULL,
  receiver_id VARCHAR(36) NOT NULL,
  encrypted_content LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_private_messages_sender (sender_id, created_at),
  KEY idx_private_messages_receiver (receiver_id, created_at),
  KEY idx_private_messages_conversation (sender_id, receiver_id, created_at),
  CONSTRAINT fk_private_messages_sender
    FOREIGN KEY (sender_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_private_messages_receiver
    FOREIGN KEY (receiver_id) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

