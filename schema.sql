-- 時事クロスワードのD1スキーマ。
-- 適用: npx wrangler d1 execute news-crossword --remote --file schema.sql
-- （CREATE TABLE IF NOT EXISTS だけなので、何度流しても既存のデータには触らない）

-- 見出しの控え。本文は持たず、見出し・媒体・掲載時刻・リンクだけ
CREATE TABLE IF NOT EXISTS news_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles (published_at DESC);

-- 期間ごとに組んだ出題。id = "1d-<通し番号>" のように期間と時間帯で決まる
CREATE TABLE IF NOT EXISTS crossword_puzzles (
  id TEXT PRIMARY KEY,
  range_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  solution_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crossword_created ON crossword_puzzles (created_at DESC);

-- クリアタイム。出題ごとの速さを競うだけで、個人は追わない
CREATE TABLE IF NOT EXISTS crossword_scores (
  id TEXT PRIMARY KEY,
  puzzle_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_puzzle ON crossword_scores (puzzle_id, ms ASC);
