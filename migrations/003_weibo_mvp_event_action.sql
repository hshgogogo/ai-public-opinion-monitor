CREATE TABLE IF NOT EXISTS source_accounts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  platform ENUM('weibo') NOT NULL DEFAULT 'weibo',
  external_id VARCHAR(220) NULL,
  profile_url VARCHAR(1000) NULL,
  display_name VARCHAR(220) NOT NULL,
  fallback_display_name VARCHAR(220) GENERATED ALWAYS AS (CASE WHEN external_id IS NULL THEN display_name ELSE NULL END) STORED,
  source_type ENUM('official','artist','producer','marketing','suspected_matrix','media','fan','organic','unknown') NOT NULL DEFAULT 'unknown',
  match_confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  confirmed_by_user TINYINT(1) NOT NULL DEFAULT 0,
  raw_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_source_account_external (platform, external_id),
  UNIQUE KEY uniq_project_source_account_display (project_id, platform, fallback_display_name),
  KEY idx_source_project_type (project_id, source_type),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS artist_public_opinion_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  platform ENUM('weibo') NOT NULL DEFAULT 'weibo',
  event_type ENUM('observation_lead','formal_event') NOT NULL DEFAULT 'observation_lead',
  title VARCHAR(240) NOT NULL,
  trigger_summary TEXT NOT NULL,
  related_artists JSON NOT NULL,
  status ENUM('observing','escalating','stable','resolved','archived') NOT NULL DEFAULT 'observing',
  risk_level ENUM('low','medium','high','critical','unknown') NOT NULL DEFAULT 'unknown',
  event_score DECIMAL(12,4) NOT NULL DEFAULT 0,
  evidence_ids JSON NOT NULL,
  timeline_json JSON NULL,
  impact_assessment TEXT NULL,
  recommended_actions JSON NULL,
  event_identity VARCHAR(320) NOT NULL DEFAULT '',
  first_seen_at TIMESTAMP NULL,
  last_seen_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_event_project_platform_identity (project_id, platform, event_identity),
  KEY idx_events_project_status (project_id, status, risk_level),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_evidence_links (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  event_id BIGINT NOT NULL,
  evidence_type ENUM('target','post','comment','sentiment','action','memory') NOT NULL,
  evidence_id BIGINT NOT NULL,
  weight DECIMAL(12,4) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_event_evidence (event_id, evidence_type, evidence_id),
  FOREIGN KEY (event_id) REFERENCES artist_public_opinion_events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_status_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  event_id BIGINT NOT NULL,
  from_status VARCHAR(80) NULL,
  to_status VARCHAR(80) NOT NULL,
  reason TEXT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES artist_public_opinion_events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publicity_actions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  platform ENUM('weibo') NOT NULL DEFAULT 'weibo',
  related_event_id BIGINT NULL,
  related_target_id BIGINT NULL,
  source ENUM('agent_recommended','user_confirmed','official_observed','matrix_inferred','manual_log') NOT NULL,
  confirmation_status ENUM('pending','confirmed','rejected','partial','uncertain') NOT NULL DEFAULT 'pending',
  action_type VARCHAR(120) NOT NULL,
  content_summary TEXT NULL,
  reason TEXT NULL,
  evidence_ids JSON NOT NULL,
  priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  owner_suggestion VARCHAR(160) NULL,
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  source_account_id BIGINT NULL,
  url VARCHAR(1000) NULL,
  observed_at TIMESTAMP NULL,
  confirmed_at TIMESTAMP NULL,
  effective_at TIMESTAMP NULL,
  recommended_check_after_at TIMESTAMP NULL,
  raw_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_actions_project_status (project_id, confirmation_status),
  KEY idx_actions_effective_time (project_id, effective_at),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id),
  FOREIGN KEY (related_event_id) REFERENCES artist_public_opinion_events(id),
  FOREIGN KEY (related_target_id) REFERENCES discovered_targets(id),
  FOREIGN KEY (source_account_id) REFERENCES source_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS action_backtests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  action_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  result ENUM('strong','medium','weak','no_signal','negative','unknown') NOT NULL DEFAULT 'unknown',
  signal_level ENUM('strong','medium','weak','none','negative','unknown') NOT NULL DEFAULT 'unknown',
  attribution_confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  baseline_window JSON NULL,
  post_windows JSON NULL,
  metric_changes JSON NULL,
  confounders JSON NOT NULL,
  next_recommendation TEXT NULL,
  missing_data_reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_backtests_project_action (project_id, action_id),
  FOREIGN KEY (action_id) REFERENCES publicity_actions(id),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE source_accounts DROP INDEX uniq_source_account_external', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'source_accounts' AND INDEX_NAME = 'uniq_source_account_external');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE source_accounts ADD UNIQUE KEY uniq_project_source_account_external (project_id, platform, external_id)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'source_accounts' AND INDEX_NAME = 'uniq_project_source_account_external');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE source_accounts ADD COLUMN fallback_display_name VARCHAR(220) GENERATED ALWAYS AS (CASE WHEN external_id IS NULL THEN display_name ELSE NULL END) STORED', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'source_accounts' AND COLUMN_NAME = 'fallback_display_name');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE source_accounts ADD UNIQUE KEY uniq_project_source_account_display (project_id, platform, fallback_display_name)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'source_accounts' AND INDEX_NAME = 'uniq_project_source_account_display');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE artist_public_opinion_events ADD COLUMN event_identity VARCHAR(320) NOT NULL DEFAULT ''''', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'artist_public_opinion_events' AND COLUMN_NAME = 'event_identity');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE artist_public_opinion_events
SET event_identity = CONCAT(title, '::', COALESCE(DATE_FORMAT(first_seen_at, '%Y-%m-%d %H:%i:%s'), 'no-first-seen'))
WHERE event_identity = '';

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE artist_public_opinion_events ADD UNIQUE KEY uniq_event_project_platform_identity (project_id, platform, event_identity)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'artist_public_opinion_events' AND INDEX_NAME = 'uniq_event_project_platform_identity');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
