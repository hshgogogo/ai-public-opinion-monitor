CREATE TABLE IF NOT EXISTS discovered_targets (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  platform ENUM('weibo') NOT NULL DEFAULT 'weibo',
  target_type VARCHAR(80) NOT NULL,
  external_id VARCHAR(220) NULL,
  url VARCHAR(1000) NULL,
  weibo_mid VARCHAR(220) NULL,
  author_external_id VARCHAR(220) NULL,
  author_url VARCHAR(1000) NULL,
  title VARCHAR(500) NULL,
  summary TEXT NULL,
  keyword VARCHAR(160) NOT NULL,
  `rank` INT NULL,
  hot_score DECIMAL(12,4) NOT NULL DEFAULT 0,
  target_locator JSON NOT NULL,
  content_fingerprint VARCHAR(120) NULL,
  raw_json JSON NULL,
  recommendation_metadata JSON NULL,
  selected_status ENUM('pending','selected','ignored') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_discovered_project_platform_external (project_id, platform, external_id),
  KEY idx_discovered_project_status (project_id, selected_status),
  KEY idx_discovered_fingerprint (platform, content_fingerprint),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE discovered_targets ADD UNIQUE KEY uniq_discovered_project_platform_external (project_id, platform, external_id)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'discovered_targets' AND INDEX_NAME = 'uniq_discovered_project_platform_external');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS target_collection_links (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  target_id BIGINT NOT NULL,
  collection_task_id BIGINT NOT NULL,
  link_type ENUM('search','detail') NOT NULL DEFAULT 'detail',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_target_task (target_id, collection_task_id),
  FOREIGN KEY (target_id) REFERENCES discovered_targets(id),
  FOREIGN KEY (collection_task_id) REFERENCES collection_tasks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE platform_auth_states
  MODIFY COLUMN status ENUM('missing','configured','invalid','expired','verification_required','rate_limited','unknown') NOT NULL DEFAULT 'missing';

ALTER TABLE collection_tasks
  MODIFY COLUMN status ENUM('queued','running','succeeded','failed','partial','analyzing','analyzed') NOT NULL DEFAULT 'queued';

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE collection_tasks ADD COLUMN crawler_engine VARCHAR(80) NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_tasks' AND COLUMN_NAME = 'crawler_engine');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE collection_tasks ADD COLUMN crawler_type ENUM(''search'',''detail'') NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_tasks' AND COLUMN_NAME = 'crawler_type');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE collection_tasks ADD COLUMN error_type VARCHAR(120) NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_tasks' AND COLUMN_NAME = 'error_type');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE collection_tasks ADD COLUMN output_path VARCHAR(1000) NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_tasks' AND COLUMN_NAME = 'output_path');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE collection_tasks ADD COLUMN raw_files JSON NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_tasks' AND COLUMN_NAME = 'raw_files');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE collection_tasks ADD COLUMN parsed_records INT NOT NULL DEFAULT 0', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_tasks' AND COLUMN_NAME = 'parsed_records');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE collection_tasks ADD COLUMN failed_records INT NOT NULL DEFAULT 0', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_tasks' AND COLUMN_NAME = 'failed_records');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE collection_tasks ADD COLUMN target_id BIGINT NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_tasks' AND COLUMN_NAME = 'target_id');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_posts ADD COLUMN source_type ENUM(''official'',''artist'',''marketing'',''fan'',''media'',''unknown'') NOT NULL DEFAULT ''unknown''', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'source_type');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_posts ADD COLUMN source_account_external_id VARCHAR(220) NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'source_account_external_id');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_posts ADD COLUMN source_account_url VARCHAR(1000) NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'source_account_url');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_posts ADD COLUMN content_fingerprint VARCHAR(120) NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'content_fingerprint');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_posts ADD COLUMN reply_count INT NOT NULL DEFAULT 0', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'reply_count');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_posts ADD COLUMN share_count INT NOT NULL DEFAULT 0', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'share_count');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_comments ADD COLUMN source_type ENUM(''official'',''artist'',''marketing'',''fan'',''media'',''unknown'') NOT NULL DEFAULT ''unknown''', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_comments' AND COLUMN_NAME = 'source_type');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_comments ADD COLUMN source_account_external_id VARCHAR(220) NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_comments' AND COLUMN_NAME = 'source_account_external_id');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_comments ADD COLUMN source_account_url VARCHAR(1000) NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_comments' AND COLUMN_NAME = 'source_account_url');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_comments ADD COLUMN content_fingerprint VARCHAR(120) NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_comments' AND COLUMN_NAME = 'content_fingerprint');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_comments ADD COLUMN comment_weight DECIMAL(12,4) NOT NULL DEFAULT 1', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_comments' AND COLUMN_NAME = 'comment_weight');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_comments ADD COLUMN reply_to_external_id VARCHAR(220) NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_comments' AND COLUMN_NAME = 'reply_to_external_id');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_comments ADD COLUMN reply_count INT NOT NULL DEFAULT 0', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_comments' AND COLUMN_NAME = 'reply_count');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE social_posts DROP INDEX uniq_platform_external', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND INDEX_NAME = 'uniq_platform_external');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_posts ADD UNIQUE KEY uniq_project_platform_external (project_id, platform, external_id)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND INDEX_NAME = 'uniq_project_platform_external');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE social_comments DROP INDEX uniq_comment_platform_external', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_comments' AND INDEX_NAME = 'uniq_comment_platform_external');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE social_comments ADD UNIQUE KEY uniq_comment_project_platform_external (project_id, platform, external_id)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_comments' AND INDEX_NAME = 'uniq_comment_project_platform_external');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
