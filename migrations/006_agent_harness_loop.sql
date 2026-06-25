CREATE TABLE IF NOT EXISTS agent_loop_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  platform ENUM('weibo') NOT NULL DEFAULT 'weibo',
  trigger_mode ENUM('after_collection','scheduled','manual','fixture') NOT NULL DEFAULT 'manual',
  target_id BIGINT NULL,
  status ENUM('pending','running','succeeded','partial','failed','needs_human') NOT NULL DEFAULT 'pending',
  current_step VARCHAR(120) NULL,
  input_json JSON NOT NULL,
  summary_json JSON NULL,
  error_type VARCHAR(120) NULL,
  error_message TEXT NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_agent_loop_project_status (project_id, platform, status, created_at),
  KEY idx_agent_loop_current_step (project_id, current_step, status),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_step_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  loop_run_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  agent_name VARCHAR(160) NOT NULL,
  step_name VARCHAR(120) NOT NULL,
  status ENUM('pending','running','succeeded','partial','failed','needs_human') NOT NULL DEFAULT 'pending',
  input_json JSON NULL,
  output_json JSON NULL,
  evidence_ids JSON NOT NULL,
  error_type VARCHAR(120) NULL,
  error_message TEXT NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_agent_step_loop (loop_run_id, step_name, status),
  KEY idx_agent_step_project_status (project_id, status, created_at),
  FOREIGN KEY (loop_run_id) REFERENCES agent_loop_runs(id),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS judge_reviews (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  loop_run_id BIGINT NOT NULL,
  step_run_id BIGINT NULL,
  project_id BIGINT NOT NULL,
  judge_agent_name VARCHAR(160) NOT NULL,
  status ENUM('pending','passed','failed','needs_human') NOT NULL DEFAULT 'pending',
  score DECIMAL(5,4) NULL,
  passed TINYINT(1) NULL,
  feedback_json JSON NULL,
  required_changes JSON NOT NULL,
  evidence_errors JSON NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_judge_loop_status (loop_run_id, status, created_at),
  KEY idx_judge_step (step_run_id),
  KEY idx_judge_project_status (project_id, status, created_at),
  FOREIGN KEY (loop_run_id) REFERENCES agent_loop_runs(id),
  FOREIGN KEY (step_run_id) REFERENCES agent_step_runs(id),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feedback_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  source_type ENUM('loop','step','judge_review','event','action','account','preference','knowledge','rule','other','source_account') NOT NULL,
  source_id BIGINT NULL,
  feedback_type ENUM('manual_handoff','needs_human','confirmed','rejected','modified','comment','preference','other','event_confirmed','event_rejected','event_observation_only','event_note','action_confirmed','action_rejected','action_partially_executed','action_not_executed','action_note','source_type_corrected','preference_added','preference_updated','manual_handoff_resolved','manual_handoff_note') NOT NULL,
  note TEXT NULL,
  status ENUM('open','in_review','resolved','rejected','archived') NOT NULL DEFAULT 'open',
  created_by VARCHAR(120) NOT NULL DEFAULT 'agent_harness',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_at TIMESTAMP NULL,
  KEY idx_feedback_project_status (project_id, status, created_at),
  KEY idx_feedback_source (source_type, source_id),
  FOREIGN KEY (project_id) REFERENCES monitor_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE feedback_items
  MODIFY COLUMN source_type ENUM('loop','step','judge_review','event','action','account','preference','knowledge','rule','other','source_account') NOT NULL;

ALTER TABLE feedback_items
  MODIFY COLUMN feedback_type ENUM('manual_handoff','needs_human','confirmed','rejected','modified','comment','preference','other','event_confirmed','event_rejected','event_observation_only','event_note','action_confirmed','action_rejected','action_partially_executed','action_not_executed','action_note','source_type_corrected','preference_added','preference_updated','manual_handoff_resolved','manual_handoff_note') NOT NULL;
