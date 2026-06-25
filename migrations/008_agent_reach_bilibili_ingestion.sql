ALTER TABLE social_posts
  MODIFY COLUMN platform ENUM('xiaohongshu','douyin','weibo','bilibili') NOT NULL;

ALTER TABLE social_comments
  MODIFY COLUMN platform ENUM('xiaohongshu','douyin','weibo','bilibili') NOT NULL;

ALTER TABLE source_accounts
  MODIFY COLUMN platform ENUM('xiaohongshu','douyin','weibo','bilibili') NOT NULL DEFAULT 'weibo';
