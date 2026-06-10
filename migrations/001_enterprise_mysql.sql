CREATE TABLE IF NOT EXISTS monitor_projects (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_name VARCHAR(120) NOT NULL,
  category VARCHAR(120) NOT NULL,
  audience VARCHAR(160) NOT NULL,
  keywords JSON NOT NULL,
  actors JSON NOT NULL,
  active_platforms JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_auth_states (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  platform ENUM('xiaohongshu','douyin','weibo') NOT NULL,
  cookie_file VARCHAR(500) NOT NULL,
  status ENUM('missing','configured','invalid') NOT NULL DEFAULT 'missing',
  last_checked_at TIMESTAMP NULL,
  UNIQUE KEY uniq_platform_auth (platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collection_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  platform ENUM('xiaohongshu','douyin','weibo') NOT NULL,
  keyword VARCHAR(160) NOT NULL,
  status ENUM('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
  requested_limit INT NOT NULL DEFAULT 50,
  collected_posts INT NOT NULL DEFAULT 0,
  collected_comments INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_posts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  platform ENUM('xiaohongshu','douyin','weibo') NOT NULL,
  external_id VARCHAR(220) NOT NULL,
  url VARCHAR(1000) NULL,
  author_name VARCHAR(220) NULL,
  title VARCHAR(500) NULL,
  content TEXT NOT NULL,
  keyword VARCHAR(160) NOT NULL,
  engagement INT NOT NULL DEFAULT 0,
  published_at TIMESTAMP NULL,
  collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_json JSON NULL,
  UNIQUE KEY uniq_platform_external (platform, external_id),
  KEY idx_project_platform_time (project_id, platform, collected_at),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_comments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  platform ENUM('xiaohongshu','douyin','weibo') NOT NULL,
  external_id VARCHAR(220) NOT NULL,
  author_name VARCHAR(220) NULL,
  content TEXT NOT NULL,
  like_count INT NOT NULL DEFAULT 0,
  published_at TIMESTAMP NULL,
  collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_json JSON NULL,
  UNIQUE KEY uniq_comment_platform_external (platform, external_id),
  KEY idx_comments_project_platform_time (project_id, platform, collected_at),
  FOREIGN KEY (post_id) REFERENCES social_posts(id),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sentiment_results (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  comment_id BIGINT NOT NULL,
  model VARCHAR(80) NOT NULL,
  sentiment ENUM('positive','neutral','negative') NOT NULL,
  score DECIMAL(5,4) NOT NULL DEFAULT 0,
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  topics JSON NOT NULL,
  risks JSON NOT NULL,
  evidence TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_comment_model (comment_id, model),
  FOREIGN KEY (comment_id) REFERENCES social_comments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NULL,
  agent_name VARCHAR(120) NOT NULL,
  status ENUM('running','succeeded','failed') NOT NULL,
  input_json JSON NULL,
  output_json JSON NULL,
  error_message TEXT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  KEY idx_agent_project_time (project_id, started_at),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS strategy_reports (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  model VARCHAR(80) NOT NULL,
  headline VARCHAR(240) NOT NULL,
  summary TEXT NOT NULL,
  actions JSON NOT NULL,
  evidence JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_strategy_project_time (project_id, created_at),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
