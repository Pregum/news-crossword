// AIプロバイダの抽象化。
//
// このアプリが使うAIは chat()（テキスト生成）だけ。出題文と解説を書かせるのに使う。
// OpenAI互換APIにも向けられるので、Ollama / LM Studio / vLLM / LiteLLM でも動く。
//
// 環境変数:
//   AI_PROVIDER   "workers-ai"(既定) | "openai" | "none"
//   AI_BASE_URL   openai時のエンドポイント (例: http://localhost:11434/v1)
//   AI_API_KEY    openai時のキー（ローカルAIなら不要なことが多い）
//   AI_MODEL_CHAT 使うモデル名（省略時はプロバイダごとの既定値）

const WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const OPENAI_MODEL = "gpt-4o-mini";

// --- Workers AI ---
function workersAiProvider(env) {
  const model = env.AI_MODEL_CHAT || WORKERS_AI_MODEL;
  return {
    name: "workers-ai",
    model,
    async chat({ system, user, maxTokens = 700 }) {
      const r = await env.AI.run(model, {
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: user },
        ],
        max_tokens: maxTokens,
      });
      // モデル/ランタイムによりresponseが文字列でなくパース済みオブジェクトのことがある
      return r?.response;
    },
  };
}

// --- OpenAI互換（Ollama / LM Studio / vLLM / LiteLLM / OpenAI本家）---
function openAiProvider(env) {
  const model = env.AI_MODEL_CHAT || OPENAI_MODEL;
  const base = String(env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const headers = {
    "content-type": "application/json",
    ...(env.AI_API_KEY ? { authorization: `Bearer ${env.AI_API_KEY}` } : {}),
  };
  return {
    name: "openai",
    model,
    async chat({ system, user, maxTokens = 700 }) {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: user },
          ],
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) {
        throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const j = await res.json();
      return j?.choices?.[0]?.message?.content ?? "";
    },
  };
}

// AIを無効にした構成でも、ヒントは見出しの伏せ字で成立する
export function getAiProvider(env) {
  const mode = env.AI_PROVIDER || (env.AI ? "workers-ai" : "none");
  if (mode === "none") return null;
  if (mode === "openai") return openAiProvider(env);
  return env.AI ? workersAiProvider(env) : null;
}
