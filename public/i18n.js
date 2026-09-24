// 軽量な多言語対応。
// 日本語の文字列そのものをキーにすることで、既存コードへの後付けを容易にしている。
// 未翻訳の文字列は日本語のまま表示される（壊れない）。
// 英語で開くには URL に #lang=en を付ける。

const EN = {
  "時事クロスワード": "News Crossword",
  "ニュースから自動生成されるクロスワード": "A crossword generated from the news",
  "出題の期間": "Puzzle window",
  "24時間": "24 hours",
  "1週間": "1 week",
  "1か月": "1 month",
  "経過タイム": "Elapsed time",
  "0 / 0 語": "0 / 0 words",
  "1マスだけ開ける（+5秒・1盤に5回まで）": "Reveal one square (+5s, up to 5 per grid)",
  "ヒントは使い切りました": "No hints left",
  "💡 ヒント": "💡 Hint",
  "手持ちの文字を並べ替える": "Shuffle your letters",
  "⤮ 並べ替え": "⤮ Shuffle",
  "置いた文字を戻して最初からやり直す": "Take every letter back and start over",
  "↺ やり直し": "↺ Reset",
  "クロスワードの盤面": "Crossword grid",
  "読み込み中…": "Loading…",
  "直近のニュースから盤面を組んでいます。": "Building a grid from the latest headlines.",
  "出題を準備中です": "No puzzle yet",
  "見出しが集まると盤面ができます。しばらくしてから開いてください。":
    "A grid appears once enough headlines have been collected. Please come back later.",
  "▶ スタート": "▶ Start",
  "手持ちの文字": "Your letters",
  "文字をタップして選び、置きたいマスをタップ。ドラッグでも置けます。置いた文字はもう一度タップで戻ります。":
    "Tap a letter, then tap a square — or just drag it there. Tap a placed letter to take it back.",
  "キーボードなら、マスを選んでローマ字で直接打てます（": "On a keyboard, pick a square and type it in rōmaji (",
  " で縦横、": " flips across/down, ",
  " で移動、": " moves, ",
  " で消す）。": " deletes).",
  "／ ヒント": "／ Clues",
  "／ 正解した語の裏側": "／ Behind the answer",
  "／ この盤のタイム": "／ Times on this grid",
  "全問正解！": "Solved!",
  "なまえ（12文字まで）": "Name (12 chars max)",
  "タイムを登録": "Submit time",
  "サンプル見出しで作ったデモ盤": "Demo grid built from sample headlines",
  "直近": "Last ",
  "本の見出しから": " headlines",
  "の時事クロスワード": " news crossword",
  "バックエンドに繋がっていないため、サンプル見出しのデモ盤です。":
    "No backend is reachable, so this is a demo grid built from sample headlines.",
  "この構成では時事クロスワードが無効なため、サンプル見出しのデモ盤です。":
    "The news crossword is disabled in this deployment, so this is a demo grid built from sample headlines.",
  "まだ見出しが集まっていないため、サンプル見出しのデモ盤です。":
    "No headlines have been collected yet, so this is a demo grid built from sample headlines.",
  "語。タイムを競います。": " words. Race the clock.",
  "ヨコ": "across",
  "タテ": "down",
  "語": "words",
  "話題量の推移": "How much it was talked about",
  "本": "",
  "時": ":00",
  "最大": "peak",
  "本の見出し": " headlines",
  "媒体": " outlets",
  "根拠になった記事 TOP3": "Top 3 sources",
  "デモ盤のため、記事へのリンクはありません。": "This is a demo grid, so there are no article links.",
  "どれくらい話題になったか": "How much it was talked about",
  "この語を含む見出しの本数": "Headlines containing this word",
  "デモ盤のタイムは記録されません。": "Times on the demo grid are not recorded.",
  "の盤": " grid",
  "ヒント": "hint",
  "秒": "s",
  "デモ盤にはランキングがありません。": "The demo grid has no leaderboard.",
  "まだ誰も解いていません。1位を狙えます。": "Nobody has solved this one yet. First place is open.",
  "タイムを登録できませんでした。": "Could not submit your time.",
  "盤ごとのタイム": "times per grid",
  "ランキングを見る盤（1週間前まで）": "Grid to show (up to 1 week back)",
  "いまの盤": "Current grid",
  "人": " players",
  "この盤は誰も解いていません。": "Nobody solved this grid.",
  "人中": " players, rank ",
  "位": "",
  "時事クロスワードを": "Solved the news crossword in ",
  "で解いた": " ",
};
// 優先順: URLハッシュ(#lang=en) > 保存済みの選択 > ブラウザの言語
const fromHash = (location.hash.match(/lang=(ja|en)/) || [])[1];
const stored = (() => {
  try { return localStorage.getItem("nl_lang"); } catch { return null; }
})();
export const LANG =
  fromHash || stored || ((navigator.language || "en").toLowerCase().startsWith("ja") ? "ja" : "en");

export function t(ja) {
  if (LANG === "ja") return ja;
  return EN[ja] ?? ja;
}

export function setLang(lang) {
  try { localStorage.setItem("nl_lang", lang); } catch {}
  location.reload();
}

// DOM内の日本語テキスト・placeholder・titleをまとめて置き換える。
// ラック等を組み立てた後に呼ぶことで、動的に作った要素も対象になる。
export function localizeDom(root = document.body) {
  if (LANG === "ja") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n);
  for (const node of targets) {
    const raw = node.nodeValue;
    const key = raw.trim();
    if (!key || !EN[key]) continue;
    node.nodeValue = raw.replace(key, EN[key]);
  }
  for (const el of root.querySelectorAll("[placeholder]")) {
    const v = EN[el.getAttribute("placeholder")];
    if (v) el.setAttribute("placeholder", v);
  }
  for (const el of root.querySelectorAll("[title]")) {
    const v = EN[el.getAttribute("title")];
    if (v) el.setAttribute("title", v);
  }
  for (const el of root.querySelectorAll("[aria-label]")) {
    const v = EN[el.getAttribute("aria-label")];
    if (v) el.setAttribute("aria-label", v);
  }
}
