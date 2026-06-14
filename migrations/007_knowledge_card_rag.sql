CREATE TABLE IF NOT EXISTS knowledge_sources (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  source_identity VARCHAR(180) NOT NULL,
  title VARCHAR(255) NOT NULL,
  source_type ENUM('official','academic','book','industry_report','award_case','platform_case','interview','media_article','self_media','other') NOT NULL,
  reliability_level ENUM('A','B','C') NOT NULL,
  citation_url VARCHAR(1024) NOT NULL,
  publisher VARCHAR(255) NULL,
  published_at DATE NULL,
  notes TEXT NULL,
  raw_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_knowledge_source_identity (source_identity),
  KEY idx_knowledge_source_reliability (reliability_level, source_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_cards (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  card_identity VARCHAR(180) NOT NULL,
  source_id BIGINT NOT NULL,
  framework_or_case VARCHAR(255) NOT NULL,
  applicable_scenario TEXT NOT NULL,
  do_not_apply_when TEXT NOT NULL,
  recommended_actions JSON NOT NULL,
  risk_warnings JSON NOT NULL,
  evidence_required JSON NOT NULL,
  judge_questions JSON NOT NULL,
  tags JSON NOT NULL,
  status ENUM('active','inactive','draft','archived') NOT NULL DEFAULT 'active',
  raw_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_knowledge_card_identity (card_identity),
  KEY idx_knowledge_card_source (source_id),
  KEY idx_knowledge_card_status (status, created_at),
  FOREIGN KEY (source_id) REFERENCES knowledge_sources(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
