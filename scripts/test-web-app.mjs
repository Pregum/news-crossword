#!/usr/bin/env node
// 時事クロスワードの画面の回帰テスト。
//
// public/ を一時ディレクトリへ複製し、crossword.js の末尾に検証コードを足して、
// headless Chrome で実際に描画させた結果を <title> から読む。
// バックエンドは無いのでデモ盤に落ち、その1盤を「タップ・ドラッグ・ローマ字入力」で
// 最後まで解かせる。
//
// 使い方: node scripts/test-web-app.mjs
// Chromeの場所は CHROME_BIN で上書きできます。見つからない環境ではスキップします。

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "public");

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// 時事クロスワードの検証コード（crossword.js の末尾に足す）。
// モジュールスコープの state / placeAt を直接触って、1盤を最後まで解かせる。
const CW_HARNESS = `
// ---- 回帰テスト用（scripts/test-web-app.mjs が末尾に足す。本番には入らない）----
(async () => {
  if (!location.hash.includes("t=cw")) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  try {
    for (let i = 0; i < 60 && !state.puzzle; i++) await wait(50);
    if (!state.puzzle) throw new Error("no puzzle");
    out.push("demo=" + state.demo);
    out.push("entries=" + state.puzzle.entries.length);
    out.push("cells=" + document.querySelectorAll(".cw-cell:not(.is-void)").length);
    out.push("clues=" + document.querySelectorAll(".cw-clue").length);
    el.start.click();
    out.push("running=" + state.running);

    // タイルをタップして選び、マスをタップして置く（画面の操作そのまま）
    const target = state.puzzle.cells.find((c) => c.ch && !state.filled.has(key(c.x, c.y)));
    const idx = state.rack.findIndex((t) => t.ch === target.ch && !t.used);
    const tile = document.querySelector('.cw-tile[data-idx="' + idx + '"]');
    tile.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
    out.push("picked=" + (state.picked === idx));
    document.querySelector('.cw-cell[data-x="' + target.x + '"][data-y="' + target.y + '"]').click();
    out.push("tapPlaced=" + (state.filled.get(key(target.x, target.y))?.ch === target.ch));

    // 違う字では語が成立しない
    const other = state.puzzle.cells.find((c) => c.ch && !state.filled.has(key(c.x, c.y)));
    const bad = state.rack.findIndex((t) => !t.used && t.ch !== other.ch);
    if (bad >= 0) {
      placeAt(other.x, other.y, bad);
      out.push("wrongKept=" + (state.solved.size === 0));
      takeBack(other.x, other.y);
      out.push("tookBack=" + !state.filled.has(key(other.x, other.y)));
    }

    // キーボード（ローマ字）で1文字置けるか
    const ROMAJI = { ア:"a", イ:"i", ウ:"u", エ:"e", オ:"o", カ:"ka", キ:"ki", ク:"ku", ケ:"ke", コ:"ko",
      サ:"sa", シ:"shi", ス:"su", セ:"se", ソ:"so", タ:"ta", チ:"chi", ツ:"tsu", テ:"te", ト:"to",
      ナ:"na", ニ:"ni", ヌ:"nu", ネ:"ne", ノ:"no", ハ:"ha", ヒ:"hi", フ:"fu", ヘ:"he", ホ:"ho",
      マ:"ma", ミ:"mi", ム:"mu", メ:"me", モ:"mo", ヤ:"ya", ユ:"yu", ヨ:"yo",
      ラ:"ra", リ:"ri", ル:"ru", レ:"re", ロ:"ro", ワ:"wa", ン:"nn", "ー":"-" };
    const typable = state.rack.find((t) => !t.used && ROMAJI[t.ch]);
    const spot = state.puzzle.cells.find((c) => c.ch && !state.filled.has(key(c.x, c.y)));
    if (typable && spot) {
      setCursor(spot.x, spot.y);
      out.push("cursor=" + !!document.querySelector(".cw-cell.is-cursor"));
      for (const k of ROMAJI[typable.ch]) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
      }
      out.push("typed=" + (state.filled.get(key(spot.x, spot.y))?.ch === typable.ch));
      out.push("moved=" + !(state.cursor?.x === spot.x && state.cursor?.y === spot.y));
      const before = state.dir;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
      out.push("flipped=" + (state.dir !== before));
      setCursor(spot.x, spot.y);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
      out.push("erased=" + !state.filled.has(key(spot.x, spot.y)));
    }

    // ヒントは5回まで。6回目は効かず、ボタンも押せなくなる
    for (let i = 0; i < 6; i++) el.hint.click();
    out.push("hints=" + state.hints);
    out.push("penalty=" + state.penaltyMs);
    out.push("hintOff=" + el.hint.disabled);
    out.push("hintLeft=" + el.hintLeft.textContent);

    for (const c of state.puzzle.cells) {
      if (!c.ch || state.filled.has(key(c.x, c.y))) continue;
      const i = state.rack.findIndex((t) => t.ch === c.ch && !t.used);
      if (i < 0) { out.push("missingTile=" + c.ch); continue; }
      placeAt(c.x, c.y, i);
    }
    out.push("solved=" + (state.solved.size === state.puzzle.entries.length));
    out.push("detail=" + !el.detail.hidden);
    out.push("chart=" + document.querySelectorAll("#cw-detail-body .cw-chart rect").length);
    out.push("result=" + !el.result.hidden);
    out.push("stopped=" + !state.running);
    out.push("filledAll=" + /^[^?]+$/.test(solutionText()));
    document.title = "OK|" + out.join("|");
  } catch (err) {
    document.title = "ERR|" + err.message + "|" + out.join("|");
  }
})();
`;

function findChrome() {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) || null;
}

async function serveDir(dir) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = join(dir, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    const target = file.endsWith("/") ? join(file, "index.html") : file;
    try {
      const body = await readFile(target);
      res.writeHead(200, { "content-type": MIME[extname(target)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

// --dump-dom は仮想時間の予算を使い切った時点のDOMを出す。
// 検証コードは結果を <title> に書くので、そこだけ読めばよい。
function runChrome(chrome, url, budgetMs) {
  return new Promise((resolve, reject) => {
    const args = [
      "--headless=new", "--disable-gpu-sandbox", "--use-angle=swiftshader",
      "--no-sandbox", "--hide-scrollbars", "--mute-audio",
      `--virtual-time-budget=${budgetMs}`, "--dump-dom", url,
    ];
    const child = spawn(chrome, args, { stdio: ["ignore", "pipe", "ignore"] });
    let dom = "";
    child.stdout.on("data", (c) => { dom += c; });
    child.on("error", reject);
    child.on("close", () => {
      const m = /<title>([^<]*)<\/title>/.exec(dom);
      resolve(m ? m[1] : "");
    });
  });
}

function parseTitle(title) {
  if (!title.startsWith("OK|")) return { ok: false, raw: title, fields: {} };
  const fields = {};
  for (const part of title.split("|").slice(1)) {
    const i = part.indexOf("=");
    if (i > 0) fields[part.slice(0, i)] = part.slice(i + 1);
  }
  return { ok: true, raw: title, fields };
}

const failures = [];
function check(name, condition, detail) {
  if (condition) console.log(`  ✓ ${name}${detail ? ` (${detail})` : ""}`);
  else {
    console.log(`  ✗ ${name}${detail ? ` (${detail})` : ""}`);
    failures.push(name);
  }
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log("Chromeが見つからないためスキップします（CHROME_BIN で場所を指定できます）");
    return;
  }

  const work = await mkdtemp(join(tmpdir(), "news-crossword-webtest-"));
  try {
    await cp(PUBLIC_DIR, work, { recursive: true });
    // moduleが評価中に落ちると <title> が変わらないままになる。原因が分かるよう捕まえる
    const html = (await readFile(join(work, "index.html"), "utf8")).replace(
      '<script type="module" src="./crossword.js"></script>',
      '<script>window.addEventListener("error", (e) => {'
      + 'document.title = "ERR|" + (e.message || "") + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno;'
      + '}, true);</script>\n<script type="module" src="./crossword.js"></script>',
    );
    await writeFile(join(work, "index.html"), html);
    await writeFile(
      join(work, "crossword.js"),
      (await readFile(join(work, "crossword.js"), "utf8")) + CW_HARNESS,
    );

    const { port, close } = await serveDir(work);
    const base = `http://127.0.0.1:${port}/`;
    try {
      console.log("時事クロスワード");
      const cw = parseTitle(await runChrome(chrome, `${base}#t=cw`, 30000));
      check("盤面が組み上がる", cw.ok, cw.ok ? "" : cw.raw);
      if (cw.ok) {
        const f = cw.fields;
        check("バックエンド無しではデモ盤になる", f.demo === "true", f.demo);
        check("ヒントの数と語の数が合う", f.clues === f.entries, `${f.clues}/${f.entries}`);
        check("マスが描かれる", Number(f.cells) > 0, f.cells);
        check("スタートでタイムが動き出す", f.running === "true", f.running);
        check("タイルをタップして選べる", f.picked === "true", f.picked);
        check("選んだ字をマスに置ける", f.tapPlaced === "true", f.tapPlaced);
        check("違う字では正解にならない", f.wrongKept === "true", f.wrongKept);
        check("カーソルが出る", f.cursor === "true", f.cursor);
        check("ローマ字で打った字が入る", f.typed === "true", f.typed);
        check("打つとカーソルが次へ進む", f.moved === "true", f.moved);
        check("スペースで縦横が切り替わる", f.flipped === "true", f.flipped);
        check("backspaceで消せる", f.erased === "true", f.erased);
        check("置いた字を戻せる", f.tookBack === "true", f.tookBack);
        check("ヒントは5回で打ち止め", f.hints === "5" && f.hintOff === "true", `${f.hints}/${f.hintOff}`);
        check("ヒント5回で+25秒", f.penalty === "25000", f.penalty);
        check("残り回数が0/5になる", f.hintLeft === "0/5", f.hintLeft);
        check("手持ちの字だけで盤が埋まる", f.filledAll === "true", f.filledAll);
        check("全部の語が正解になる", f.solved === "true", f.solved);
        check("正解した語の詳細が出る", f.detail === "true", f.detail);
        check("話題量のチャートが描かれる", Number(f.chart) > 0, f.chart);
        check("クリア画面が出てタイムが止まる", f.result === "true" && f.stopped === "true", `${f.result}/${f.stopped}`);
      }
    } finally {
      await close();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\nnews crossword web tests FAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nnews crossword web tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
