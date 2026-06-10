CREATE TABLE IF NOT EXISTS bot_memory_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  source_kind ENUM('target','comment','analysis','event','action','backtest','report','preference','conversation') NOT NULL,
  source_id BIGINT NULL,
  title VARCHAR(240) NOT NULL,
  summary TEXT NOT NULL,
  evidence_ids JSON NOT NULL,
  memory_json JSON NULL,
  importance DECIMAL(5,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_memory_project_kind (project_id, source_kind, created_at),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bot_conversations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  title VARCHAR(240) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_conversations_project (project_id, updated_at),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bot_messages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  role ENUM('user','assistant','system') NOT NULL,
  content TEXT NOT NULL,
  cited_source_ids JSON NOT NULL,
  error_type VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_messages_conversation (conversation_id, created_at),
  FOREIGN KEY (conversation_id) REFERENCES bot_conversations(id),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_reports (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  markdown_body MEDIUMTEXT NOT NULL,
  data_coverage JSON NOT NULL,
  top_judgments JSON NOT NULL,
  evidence_ids JSON NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_daily_report (project_id, report_date),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
