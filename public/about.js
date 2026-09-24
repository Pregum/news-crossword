// 出題のしくみのページ。語の一覧は判定に使っているものをそのまま読み込んで並べる
// （ページに書き写すと、判定を直したときに説明だけ古くなるため）。

import { CRIME_WORDS, STOPWORDS } from "./crossword-core.js";

function fill(id, words) {
  const list = document.getElementById(id);
  for (const w of words) {
    const li = document.createElement("li");
    li.textContent = w;
    list.appendChild(li);
  }
}

fill("ab-crime", CRIME_WORDS);
fill("ab-stop", [...STOPWORDS]);
