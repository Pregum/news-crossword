// 時事クロスワードの Worker。
//
//   fetch()      静的ページの配信と、出題・ランキング・収集のAPI
//   scheduled()  1時間ごとにRSSを集めて、期限の切れた出題を組み直す
//
// 必要なバインディングは D1（DB）だけ。無ければ /api/news/* は 503 を返し、
// ページ側はサンプル見出しのデモ盤に落ちる。AI・レート制限・計測はどれも任意。

import { DurableObject } from "cloudflare:workers";
import { getAiProvider } from "./ai.js";
import {
  boardsRoute,
  newsEnabled,
  puzzleRoute,
  refreshAll,
  scoresRoute,
  submitScoreRoute,
} from "./newsroute.js";

const WINDOW_MS = 60_000; // レート制限ウィンドウ幅

// キー（IP等）ごとに1インスタンス割り当てて固定ウィンドウでカウントする
export class RateLimiter extends DurableObject {
  async check(limit = 5) {
    const now = Date.now();
    let w = (await this.ctx.storage.get("w")) ?? null;
    if (!w || now - w.start >= WINDOW_MS) w = { start: now, count: 0 };
    w.count++;
    await this.ctx.storage.put("w", w);
    return w.count <= limit;
  }

  // 日次のAI予算を消費する（UTC日で自動リセット。Cloudflareの無料枠リセットと同じ区切り）
  async spendDaily(cost, cap) {
    const day = Math.floor(Date.now() / 86_400_000);
    let b = (await this.ctx.storage.get("b")) ?? null;
    if (!b || b.day !== day) b = { day, used: 0 };
    if (b.used + cost > cap) return { ok: false, used: b.used, cap };
    b.used += cost;
    await this.ctx.storage.put("b", b);
    return { ok: true, used: b.used, cap };
  }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });

const clientIp = (req) => req.headers.get("cf-connecting-ip") || "unknown";

async function rateLimit(env, key, limit) {
  // Durable Objectsを繋いでいない構成でも動くようにする
  if (!env.LIMITER) return true;
  try {
    return await env.LIMITER.get(env.LIMITER.idFromName(key)).check(limit);
  } catch {
    return true;
  }
}

// 手動の収集（/api/news/refresh）だけに要るキー。未設定なら手動収集は使えない（cronは動く）
function authed(req, env) {
  if (!env.ADMIN_KEY) return false;
  return req.headers.get("x-admin-key") === env.ADMIN_KEY;
}

// ---------------------------------------------------------------- AI予算
// Workers AIの無料枠（1日10,000ニューロン）の手前で自分から止める。
// ヒント生成は llama-3.1-8b を1回呼ぶだけなので、1回あたり30ニューロンと見積もる
const DEFAULT_AI_DAILY_CAP = 8000;
const AI_COST_HINT = 30;

async function spendAiBudget(env) {
  const cap = Number(env.AI_DAILY_CAP) || DEFAULT_AI_DAILY_CAP;
  try {
    const stub = env.LIMITER.get(env.LIMITER.idFromName("ai-budget-global"));
    return await stub.spendDaily(AI_COST_HINT, cap);
  } catch {
    // 予算カウンタが無い/落ちている場合は通す（機能停止より継続を優先）
    return { ok: true, used: 0, cap };
  }
}

// ---------------------------------------------------------------- 計測（需要の把握）
// 「どれだけ遊ばれているか」だけを知るための仕組み。
// 個人は追跡しない: IP・User-Agent・名前は記録せず、地域は国コードまでに丸める。
// Analytics Engineのバインディングが無い構成では丸ごと何もしない。
function trackEvent(env, req, event, label = "", value = 1) {
  if (!env.ANALYTICS) return;
  try {
    env.ANALYTICS.writeDataPoint({
      indexes: [event],
      blobs: [event, String(label ?? "").slice(0, 64), req?.cf?.country ?? "XX"],
      doubles: [Number(value) || 0],
    });
  } catch {
    // 計測の失敗で本来の処理を止めない
  }
}

// ハンドラの結果（成否）まで含めて1件記録する
async function tracked(env, req, event, promise) {
  const res = await promise;
  trackEvent(env, req, event, res.ok ? "ok" : String(res.status));
  return res;
}

// クライアントから受け付けるイベント名。許可リストの外は捨てる
const CLIENT_EVENTS = new Set([
  "cw_open",   // 開いた（label = 期間）
  "cw_start",  // 実際に解き始めた（label = 期間）
  "cw_clear",  // 全問正解した（label = 期間、value = 秒）
  "cw_hint",   // ヒントを使った（label = 期間）
]);
const MAX_EVENT_BODY = 4096;
const MAX_EVENTS_PER_REQ = 20;

async function handleEvent(req, env) {
  // 計測先が無い構成では受け取らない（クライアントも/api/configを見て送信しない）
  if (!env.ANALYTICS) return new Response(null, { status: 204 });
  if (Number(req.headers.get("content-length")) > MAX_EVENT_BODY) {
    return new Response(null, { status: 204 });
  }
  if (!(await rateLimit(env, clientIp(req) + "#ev", 60))) {
    return new Response(null, { status: 204 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const list = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS_PER_REQ) : [];
  for (const it of list) {
    if (!CLIENT_EVENTS.has(it?.e)) continue;
    trackEvent(env, req, it.e, typeof it.l === "string" ? it.l : "", Number(it.v) || 1);
  }
  // 計測は本流ではないので、失敗も成功も同じ204で返す
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------- 外部の計測タグ
// 環境変数が設定されているときだけ<head>に足す。未設定なら1バイトも入らないので、
// forkした人の計測先が作者になることはない。値は形式を検証し、外れたものは無視する。
const TAG_PATTERNS = {
  WEB_ANALYTICS_TOKEN: /^[0-9a-f]{32}$/i,        // Cloudflare Web Analyticsのトークン
  GA_MEASUREMENT_ID: /^G-[A-Z0-9]{4,20}$/i,      // GA4の測定ID
  PLAUSIBLE_DOMAIN: /^[a-z0-9.-]{3,120}$/i,      // Plausible等に登録したドメイン
};

function tagValue(env, name) {
  const v = env[name];
  if (!v) return null;
  if (TAG_PATTERNS[name].test(v)) return v;
  console.warn(`analytics: ${name} の形式が不正なため無視しました`);
  return null;
}

function analyticsTags(env) {
  const out = [];
  const cf = tagValue(env, "WEB_ANALYTICS_TOKEN");
  if (cf) {
    out.push(
      `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" ` +
      `data-cf-beacon='{"token":"${cf}"}'></script>`
    );
  }
  const plausible = tagValue(env, "PLAUSIBLE_DOMAIN");
  if (plausible) {
    // セルフホスト版を使う場合は PLAUSIBLE_SRC でスクリプトの場所を差し替える
    const src = env.PLAUSIBLE_SRC || "https://plausible.io/js/script.js";
    if (/^https:\/\/[a-z0-9.\-\/]+\.js$/i.test(src)) {
      out.push(`<script defer data-domain="${plausible}" src="${src}"></script>`);
    }
  }
  const ga = tagValue(env, "GA_MEASUREMENT_ID");
  if (ga) {
    out.push(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script>` +
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}` +
      `gtag('js',new Date());gtag('config','${ga}');</script>`
    );
  }
  return out.join("");
}

// OGPの絶対URLはデプロイ先で変わるため、配信時にoriginを埋める
function decorateHtml(res, origin, env) {
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  // HTMLRewriterはセレクタリスト(カンマ区切り)に対応しないため個別に登録する
  const absolutize = {
    element(el) {
      const c = el.getAttribute("content");
      if (c && c.startsWith("/")) el.setAttribute("content", origin + c);
    },
  };
  let rw = new HTMLRewriter()
    .on('meta[property="og:url"]', absolutize)
    .on('meta[property="og:image"]', absolutize);
  const tags = analyticsTags(env);
  if (tags) {
    rw = rw.on("head", { element: (el) => el.append(tags, { html: true }) });
  }
  return rw.transform(res);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const { pathname } = url;

    // フロントに構成を伝える。計測先が無い構成では、クライアントはイベントを一切送らない
    if (pathname === "/api/config") {
      const ai = getAiProvider(env);
      return json({
        news: newsEnabled(env),
        ai: !!ai,
        aiProvider: ai?.name ?? "none",
        analytics: !!env.ANALYTICS,
      });
    }

    // クライアントからの利用イベント（許可リストのイベント名のみ受け付ける）
    if (pathname === "/api/event" && req.method === "POST") {
      return handleEvent(req, env);
    }

    if (pathname.startsWith("/api/news/")) {
      // 見出しを貯めるD1が無ければ、ページ側はデモ盤に落ちる
      if (!newsEnabled(env)) return json({ error: "disabled", reason: "news" }, 503);
      const ai = getAiProvider(env);
      const spend = () => spendAiBudget(env);

      if (pathname === "/api/news/puzzle" && req.method === "GET") {
        return tracked(env, req, "news_puzzle", puzzleRoute(req, env, { ai, spend }));
      }
      if (pathname === "/api/news/scores" && req.method === "GET") {
        return scoresRoute(req, env);
      }
      if (pathname === "/api/news/boards" && req.method === "GET") {
        return boardsRoute(req, env);
      }
      if (pathname === "/api/news/scores" && req.method === "POST") {
        return tracked(
          env, req, "news_score",
          submitScoreRoute(req, env, { rateLimit, ip: clientIp(req) })
        );
      }
      // 手動での収集。cronを待たずに試すためのもので、アクセスキーが要る
      if (pathname === "/api/news/refresh" && req.method === "POST") {
        if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
        return json(await refreshAll(env, { ai, spend }));
      }
      return json({ error: "not found" }, 404);
    }

    return decorateHtml(await env.ASSETS.fetch(req), url.origin, env);
  },

  // 時事ネタの収集。wrangler.jsonc の crons で1時間ごとに呼ばれる。
  // 収集のついでに、期限の切れた出題を組み直しておく（最初の訪問者を待たせない）。
  async scheduled(event, env, ctx) {
    if (!newsEnabled(env)) return;
    const ai = getAiProvider(env);
    const spend = () => spendAiBudget(env);
    ctx.waitUntil(
      refreshAll(env, { ai, spend })
        .then((r) => console.log("news refresh", JSON.stringify(r)))
        .catch((err) => console.error("news refresh failed", err))
    );
  },
};
