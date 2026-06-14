/**
 * main.js
 * SUBUTOMO PROTOCOL CLI — メインメニュー
 */

import * as readline from 'readline';
import { encode, decode } from './SubutomoProtocol.js';
import { launch as diagnosticMode } from './DiagnosticMode.js';

// ─── ターミナル制御 ───────────────────────────────────────────────────────────
const E = '\x1b';
const T = {
  clr : `${E}[2J${E}[H`,
  fGrn: `${E}[32m`,
  fCyn: `${E}[36m`,
  fYel: `${E}[33m`,
  fRed: `${E}[31m`,
  bold: `${E}[1m`,
  dim : `${E}[2m`,
  rst : `${E}[0m`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── readline インターフェース ────────────────────────────────────────────────
let rl = makeRl();
function makeRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}
const ask = (q) => new Promise((r) => rl.question(q, r));

// ─── メインメニュー表示 ───────────────────────────────────────────────────────
function showMainMenu() {
  process.stdout.write(T.clr);
  console.log(T.fGrn + T.bold);
  console.log('  ╔════════════════════════════════════╗');
  console.log('  ║   SUBUTOMO PROTOCOL  v1.0.0        ║');
  console.log('  ╠════════════════════════════════════╣');
  console.log('  ║                                    ║');
  console.log('  ║   [1] エンコード                   ║');
  console.log('  ║   [2] デコード                     ║');
  console.log('  ║   [9] その他  (OTHER)              ║');
  console.log('  ║   [0] 終了                         ║');
  console.log('  ║                                    ║');
  console.log('  ╚════════════════════════════════════╝' + T.rst);
  console.log();
}

// ─── エンコード操作 ──────────────────────────────────────────────────────────
async function doEncode() {
  console.log(T.fCyn + '\n  ─── エンコード ───────────────────\n' + T.rst);
  const name  = (await ask('  名前（最大5文字）: ')).trim();
  const score = parseInt(await ask('  スコア（0–16777215）: '), 10);
  const level = parseInt(await ask('  レベル（0–15）: '), 10);
  try {
    const code = encode(name, score, level);
    console.log(T.fGrn + T.bold + `\n  コード: ${code}\n` + T.rst);
  } catch (err) {
    console.error(T.fYel + `\n  エラー: ${err.message}\n` + T.rst);
  }
  await ask('  [Enter] でメニューへ戻る ');
}

// ─── デコード操作 ─────────────────────────────────────────────────────────────
async function doDecode() {
  console.log(T.fCyn + '\n  ─── デコード ───────────────────\n' + T.rst);
  const code   = (await ask('  コード: ')).trim();
  const result = decode(code);

  if (result.isValid || result.isOfficial) {
    console.log(T.fGrn + T.bold + '\n  [ 復元成功 ]' + T.rst);
    console.log(`  名前     : ${result.name}`);
    console.log(`  スコア   : ${result.score}`);
    console.log(`  レベル   : ${result.level}`);
    console.log(`  正規コード: ${result.isValid}`);
    console.log(`  公式コード: ${result.isOfficial}`);
  } else {
    console.log(T.fYel + `\n  [ 失敗 ] ${result.error ?? '署名が一致しません'}\n` + T.rst);
  }

  await ask('\n  [Enter] でメニューへ戻る ');
}

// ─── その他メニュー ───────────────────────────────────────────────────────────
async function doOther() {
  process.stdout.write(T.clr);
  console.log(T.fGrn + T.bold);
  console.log('  ╔════════════════════════════════════╗');
  console.log('  ║   その他  (OTHER)                  ║');
  console.log('  ╠════════════════════════════════════╣');
  console.log('  ║                                    ║');
  console.log('  ║   [1] バージョン情報               ║');
  console.log('  ║   [D] ██████████████  ← 診断        ║');
  console.log('  ║   [0] 戻る                         ║');
  console.log('  ║                                    ║');
  console.log('  ╚════════════════════════════════════╝' + T.rst);
  console.log();

  const sel = (await ask('  選択: ')).trim().toUpperCase();

  if (sel === '1') {
    console.log(
      T.dim +
      '\n  subutomo-syn v1.0.0\n' +
      '  SubutomoProtocol — ビットインターリーブ符号化ライブラリ\n' +
      '  ビット置換 + スコアベースローテーション + HMAC-Lite 署名\n' +
      T.rst
    );
    await ask('  [Enter] でメニューへ戻る ');
  } else if (sel === 'D') {
    // readline を閉じてから診断モードへ（stdin 競合回避）
    rl.close();
    await diagnosticMode();
    console.log(T.dim + '\n  診断モードを終了しました。\n' + T.rst);
    process.exit(0);
  }
}

// ─── メインループ ─────────────────────────────────────────────────────────────
async function main() {
  while (true) {
    showMainMenu();
    const sel = (await ask('  選択: ')).trim();

    switch (sel) {
      case '0':
        console.log(T.fGrn + '\n  終了します。\n' + T.rst);
        rl.close();
        process.exit(0);
        break;
      case '1': await doEncode(); break;
      case '2': await doDecode(); break;
      case '9': await doOther(); break;
      default:
        console.log(T.dim + '  無効な選択です。\n' + T.rst);
        await sleep(700);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
