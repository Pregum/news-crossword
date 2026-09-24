# 時事クロスワード / News Crossword

**直近のニュースからその場で組み上がるクロスワード。** 1分で解ける大きさで、同じ盤を解いた人どうしでタイムを競えます。
Cloudflare Workers + D1 + Workers AI だけで動き、**依存パッケージはゼロ**（`package.json` もありません）。

**公開中の盤**: <https://news-crossword.pregum-dev.workers.dev/>（独自ドメインは未設定で、`workers.dev` のサブドメインのまま動かしています）

```
cron（毎時）→ RSSを取得 → 見出しだけをD1へ
                                  ↓
        期間で絞る（24時間 / 1週間 / 1か月）
                                  ↓
  カタカナ語を頻度＋鮮度＋媒体の数で採点 → 上位を交差配置 → 盤面
                                  ↓
        LLMが出題文と解説を作る（無ければ見出しの伏せ字）
```

## 遊び方

- **手持ちの文字を置いて解きます**（もじぴったんの要領）。空きマスぶんの文字＋おじゃま数枚がラックに並び、
  タップかドラッグでマスへ置きます。語が正しく埋まるとその場で確定してマスが光ります
- **PCではローマ字で直接打てます**。マスを選んで `wa-rudokappu` と打てば ワールドカツプ が入ります。
  IMEの変換窓を待つとその分だけタイムが延びるので、変換器（`public/romaji.js`）を自前で持っています
  （スペースで縦横、矢印で移動、backspaceで消す）
- **タイムで競います**。スタートで計測開始、ヒントは +5秒（1盤に5回まで）。全問正解でクリア画面 → 名前を入れて登録 → その盤のランキング
- **正解した語には裏側が付きます**。LLMの解説、根拠になった記事TOP3（媒体が散るように選ぶ・リンク付き）、
  期間内の話題量チャート（1日なら1時間刻み、1週間/1か月なら1日刻み）
- 英語UIは URL に `#lang=en` を付けると出ます

## 仕組みの決めごと

- **盤に載るのはカタカナ語だけ**です。漢字の読みを得るには辞書が要り、それは「依存を増やさない」という
  決めごとと両立しません。時事の見出しはカタカナ語（人名・企業名・競技名・製品名）が濃いので、これで十分に
  成立します。小書き文字（ャュョッ）は日本語のクロスワードの慣例どおり大きい字1マスとして扱います
- **AIは出題文と解説だけ**を書きます。語の選定は数えれば分かるので、数えた結果を使います。
  AIが無い構成（`AI_PROVIDER=none` / ローカル）でも、見出しの伏せ字がそのままヒントになります
- **出題は期間ごとにキャッシュ**されます（24時間=3時間、1週間=12時間、1か月=24時間）。
  同じ盤を全員が解くのでタイムを比べられ、AIを呼ぶのは1日あたり数回で済みます。
  盤を組む重い処理は cron 側に寄せてあり、訪問者を待たせません
- **タイムの登録は、盤の答えのハッシュが合ったものだけ**受け付けます（順位はお遊びなので、これ以上の防御はしません）
- 記事は**見出し・媒体・掲載時刻・リンクだけ**を保存します（本文は取りません）。35日で消えます
- **バックエンドが無い構成**（`file://` や静的ホスティング）では、同じ生成コードをブラウザで回して
  サンプル見出しのデモ盤に落ちます。デモになった理由も画面に出します

## デプロイ

### 手元のPCから

```sh
npx wrangler login
npx wrangler d1 create news-crossword          # 出てきた database_id を wrangler.jsonc に書く
npx wrangler d1 execute news-crossword --remote --file schema.sql
npx wrangler secret put ADMIN_KEY              # 手動収集用（任意。長いランダム文字列）
npx wrangler deploy                            # cron（毎時7分）も一緒に登録される

# cron を待たずに最初の見出しを集める
curl -X POST https://news-crossword.<account>.workers.dev/api/news/refresh -H "x-admin-key: <ADMIN_KEY>"
```

### GitHub のボタンから（PCが手元に無いとき）

リポジトリの Secret に `CLOUDFLARE_API_TOKEN`（Cloudflareの「Edit Cloudflare Workers」テンプレートで発行し、
D1 の編集権限を足したもの）を入れておくと、Actions → deploy → Run workflow のボタンでデプロイできます。
初回は「schema.sql をD1へ適用」をONに、収集URL（`https://<ホスト>/api/news/refresh`）を入れておくと、
そのまま最初の見出し集めまで済みます（`ADMIN_KEY` の Secret が要ります）。自動では走りません。

### 環境変数（`.dev.vars.example` 参照）

| 変数 | 既定 | 説明 |
|---|---|---|
| `ADMIN_KEY` | なし | `POST /api/news/refresh` のキー。未設定なら手動収集は使えない（cron は動く） |
| `NEWS_FEEDS` | Googleニュース9本 | 読むRSS/AtomのURL（カンマ区切り。`https://` のみ） |
| `AI_PROVIDER` | `workers-ai` | `workers-ai` / `openai` / `none` |
| `AI_BASE_URL` / `AI_API_KEY` | なし | `openai` 時のエンドポイントとキー（Ollama 等のローカルAIにも向けられる） |
| `AI_MODEL_CHAT` | プロバイダ既定 | 使用モデル名（Workers AI は `@cf/meta/llama-3.1-8b-instruct-fp8`） |
| `AI_DAILY_CAP` | `8000` | 1日あたりのAI予算（ニューロン）。超えたら伏せ字ヒントに切り替わる |
| `WEB_ANALYTICS_TOKEN` / `GA_MEASUREMENT_ID` / `PLAUSIBLE_DOMAIN` | なし | 設定したときだけ計測タグを `<head>` に足す |

バインディングで必須なのは D1（`DB`）だけです。AI・Durable Objects（レート制限とAI予算）・
Analytics Engine は `wrangler.jsonc` から外しても動きます。

## API

| エンドポイント | 説明 |
|---|---|
| `GET /api/news/puzzle?range=1d\|1w\|1m` | 出題データ（盤・ヒント・根拠・話題量）。期間ごとにキャッシュ |
| `GET /api/news/scores?puzzle=<id>` | その盤のタイム上位20件 |
| `POST /api/news/scores` | タイムの登録。盤の答えのハッシュが合ったものだけ受け付ける |
| `POST /api/news/refresh` | 手動で収集する（`x-admin-key` が必要） |
| `GET /api/config` | フロントに構成（`news` / `ai` / `analytics`）を伝える |

## 開発

```sh
npx wrangler dev                       # http://localhost:8787（D1 はローカルのSQLiteに置き換わる）
node scripts/test-crossword.mjs        # 見出しの解析・語の抽出・盤面の組み立て
node scripts/test-web-app.mjs          # headless Chrome で実際に1盤解かせる回帰テスト
```

`public/index.html` をそのままブラウザで開いてもデモ盤で遊べます。

```
public/
  index.html         画面
  crossword.js       操作（タップ・ドラッグ・ローマ字入力・タイム・ランキング）
  crossword-core.js  見出し→盤面の生成（Worker・ブラウザ・Nodeで共用する純関数）
  crossword.css      盤面・ラック・ヒント・ランキングの見た目
  style.css          土台の配色・ヘッダ・ボタン
  romaji.js          ローマ字→カタカナ（打鍵ごとに1文字ずつ確定させる）
  i18n.js            日本語・英語の文言
  analytics.js       利用イベントの送信（送信先が無ければ何もしない）
src/
  worker.js          ルーティング・cron・レート制限・AI予算
  newsroute.js       収集・出題・ランキング
  news.js            RSS/Atomの取得と解析
  ai.js              AIプロバイダの抽象化（workers-ai / openai / none）
  json.js            LLMの返事からJSONだけを取り出す
schema.sql           D1スキーマ
```

## 利用状況の計測

「どれだけ遊ばれているか」を知るためだけの仕組みで、すべて任意です。
`wrangler.jsonc` の `analytics_engine_datasets` を外せば丸ごと無効になります。

| イベント | ラベル | 意味 |
|---|---|---|
| `cw_open` / `cw_start` / `cw_hint` | 期間（`1d` `1w` `1m` / `demo`） | 開いた / 解き始めた / ヒントを使った |
| `cw_clear` | 同上（値 = 秒） | 全問正解した |
| `news_puzzle` / `news_score` | `ok` / HTTPステータス | 出題の取得 / タイムの登録 |

**記録しないもの**: IP・User-Agent・Cookie・訪問者ID・登録した名前。地域は国コードまでに丸めています。

## 由来

もともと [NOIZ LAB（image_effector）](https://github.com/Pregum/image_effector) の一機能として作ったものを、
単体で動くように切り出しました。CRT調の見た目はそこから引き継いでいます。

## License

MIT
