SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE sentiment_results ADD COLUMN stance ENUM(''supportive'',''opposed'',''questioning'',''neutral'',''unclear'') NOT NULL DEFAULT ''unclear''', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sentiment_results' AND COLUMN_NAME = 'stance');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE sentiment_results ADD COLUMN issue_summary TEXT NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sentiment_results' AND COLUMN_NAME = 'issue_summary');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE sentiment_results ADD COLUMN intensity DECIMAL(5,4) NOT NULL DEFAULT 0', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sentiment_results' AND COLUMN_NAME = 'intensity');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE sentiment_results ADD COLUMN weight_snapshot DECIMAL(12,4) NOT NULL DEFAULT 1', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sentiment_results' AND COLUMN_NAME = 'weight_snapshot');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE sentiment_results ADD COLUMN analysis_json JSON NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sentiment_results' AND COLUMN_NAME = 'analysis_json');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE sentiment_results ADD COLUMN fallback_type ENUM(''none'',''local_rules'',''deepseek_failed'',''timeout'',''parse_error'') NOT NULL DEFAULT ''none''', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sentiment_results' AND COLUMN_NAME = 'fallback_type');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE sentiment_results ADD COLUMN analyzed_at TIMESTAMP NULL', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sentiment_results' AND COLUMN_NAME = 'analyzed_at');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
