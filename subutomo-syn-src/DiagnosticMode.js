/**
 * DiagnosticMode.js
 * セキュア診断モード — 階層型認証システム
 *
 * セキュリティ原則:
 *   - 正解文字列リテラルはソース内に存在しない（バイト列 -> SHA-256 で比較）
 *   - プロンプトテキストは Hex エンコード保持、表示直前にのみ復元
 *   - 入力は大文字正規化後にハッシュ比較
 */

import { createHash } from 'crypto';

// --- 正解ハッシュ定数（文字列リテラルなし、バイト列から SHA-256 を計算） ---
// 各配列は ASCII コードポイントの羅列であり、文字列リテラルとして出現しない。
const _sha = (b) => createHash('sha256').update(Buffer.from(b)).digest('hex');

const HASH = Object.freeze({
  // Layer1/2 一般保守員:  K=75 A=65 W=87 A=65
  kawa:    _sha([75, 65, 87, 65]),
  // Layer1/2 上級保守員:  F=70 U=85 J=74 I=73 S=83 A=65 N=78
  fujisan: _sha([70, 85, 74, 73, 83, 65, 78]),
  // Layer3   スーパーバイザー: S=83 U=85 B=66 U=85 T=84 A=65
  subuta:  _sha([83, 85, 66, 85, 84, 65]),
});

// --- プロンプト定数（Hex エンコード保持、表示直前にのみ復元） ---
const PHEX = Object.freeze({
  a: '59414d41',                           // テキストA: 4文字
  b: '484144414b414e4f425554414741495255', // テキストB: 17文字
});
const fromHex = (h) =>
  h.match(/.{2}/g).map((b) => String.fromCharCode(parseInt(b, 16))).join('');

// --- ターミナル出力ユーティリティ ---
const W = (s) => process.stdout.write(s);

const ESC = '\x1b';
const T = {
  clr   : ESC + '[2J' + ESC + '[H',
  bgBlk : ESC + '[40m',
  fGrn  : ESC + '[32m',
  fHGrn : ESC + '[92m',
  fYel  : ESC + '[33m',
  fRed  : ESC + '[31m',
  fCyn  : ESC + '[36m',
  bold  : ESC + '[1m',
  blink : ESC + '[5m',
  dim   : ESC + '[2m',
  rst   : ESC + '[0m',
  hidCur: ESC + '[?25l',
  shwCur: ESC + '[?25h',
};

// キーコード定数（制御文字を文字列リテラルで持たない）
const KEY_CTRL_C  = String.fromCharCode(3);   // ETX / Ctrl+C
const KEY_DEL     = String.fromCharCode(127);  // DEL / Backspace
const KEY_BS      = String.fromCharCode(8);    // BS

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// タイプライター効果（レトロな打鍵ランダム揺らぎ付き）
async function type(text, baseMs) {
  const ms = baseMs !== undefined ? baseMs : 22;
  for (const ch of text) {
    W(ch);
    await sleep(ms + ((Math.random() * 14) | 0));
  }
}

// --- 起動アニメーション（全画面暗転 + 点滅演出） ---
async function bootAnimation() {
  W(T.hidCur + T.bgBlk + T.clr);
  await sleep(80);

  // 全画面フラッシュ x3
  for (let i = 0; i < 3; i++) {
    const bar = T.fGrn + T.bold + '▓'.repeat(58) + T.rst + T.bgBlk;
    W('\n' + bar + '\n' + bar + '\n' + bar + '\n');
    await sleep(160);
    W(T.clr);
    await sleep(110);
  }

  // ブートシーケンス
  W(T.bgBlk + T.fGrn + T.bold);
  await type('\n\n  ██ SUBUTOMO DIAGNOSTIC SYSTEM v1.0 ██\n', 38);
  W(T.dim);
  await type('  ──────────────────────────────────────\n', 10);
  W(T.rst + T.bgBlk + T.fGrn);
  await sleep(200);
  await type('  > セキュアチャンネル 初期化中...\n', 28);
  await sleep(120);
  await type('  > 接続確立\n', 28);
  await sleep(120);
  await type('  > 認証プロセス 開始\n', 28);
  await sleep(350);
  W(T.dim);
  await type('  ──────────────────────────────────────\n', 10);
  W(T.rst + T.bgBlk);
}

// --- マスク入力（入力文字を * でマスクして表示） ---
async function maskedPrompt(label) {
  W(T.fHGrn + '\n  ' + label + ' > ' + T.fYel);

  // TTY 以外（パイプ・CI 環境など）は素の readline で読む
  if (!process.stdin.isTTY) {
    const { createInterface } = await import('readline');
    const iface = createInterface({ input: process.stdin, terminal: false });
    return new Promise((resolve) => {
      iface.once('line', (l) => { iface.close(); W('\n'); resolve(l.trim()); });
    });
  }

  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (ch) => {
      if (ch === '\r' || ch === '\n') {
        // Enter: 入力確定
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        W(T.rst + '\n');
        resolve(buf);
      } else if (ch === KEY_CTRL_C) {
        // Ctrl+C: 強制終了
        process.stdin.setRawMode(false);
        W(T.shwCur + T.rst + '\n');
        process.exit(0);
      } else if (ch === KEY_DEL || ch === KEY_BS) {
        // Backspace / DEL: 1文字削除
        if (buf.length) {
          buf = buf.slice(0, -1);
          W('\b \b');
        }
      } else if (ch >= ' ') {
        buf += ch;
        W('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

// --- ハッシュ比較（大文字正規化 -> SHA-256） ---
const hashOf = (s) =>
  createHash('sha256').update(s.toUpperCase()).digest('hex');

// --- 権限付与画面 ---
async function showGranted(role) {
  W(T.clr + T.bgBlk);
  await sleep(250);

  const cfgMap = {
    general: {
      color: T.fGrn + T.bold,
      box: [
        '  ╔══════════════════════════════════════╗',
        '  ║   [ 認証成功 ]                        ║',
        '  ║   権限レベル : 一般保守員              ║',
        '  ║   MAINTENANCE ACCESS GRANTED          ║',
        '  ╚══════════════════════════════════════╝',
      ],
    },
    senior: {
      color: T.fYel + T.bold,
      box: [
        '  ╔══════════════════════════════════════╗',
        '  ║   [ 認証成功 ]                        ║',
        '  ║   権限レベル : 上級保守員              ║',
        '  ║   SENIOR MAINTENANCE ACCESS           ║',
        '  ╚══════════════════════════════════════╝',
      ],
    },
    supervisor: {
      color: T.fRed + T.bold,
      box: [
        '  ╔══════════════════════════════════════╗',
        '  ║   [ 認証成功 ]                        ║',
        '  ║   権限レベル : スーパーバイザー        ║',
        '  ║   SUPERVISOR ACCESS GRANTED           ║',
        '  ╚══════════════════════════════════════╝',
      ],
    },
  };

  const cfg = cfgMap[role];
  W(cfg.color);
  for (const line of cfg.box) await type('\n' + line, 16);

  // スーパーバイザー専用: 落とし戸チャンネル情報
  if (role === 'supervisor') {
    W(T.fCyn + T.dim);
    await sleep(500);
    await type('\n\n  >>> 落とし戸チャンネル 開放\n', 18);
    await type('  >>> OFFICIAL_SALT 署名モード 有効化\n', 18);
    await type('  >>> SubutomoProtocol 最上位アクセス 確立\n', 18);
  }

  W(T.rst + '\n');
  await sleep(2200);
}

// --- 認証失敗画面 ---
async function showDenied() {
  W(T.fRed + T.bold);
  await type('\n  [ 認証失敗 ]  ACCESS DENIED\n', 28);
  W(T.dim + T.fRed);
  await type('  セキュリティログに記録されました。\n', 24);
  W(T.rst);
  await sleep(1400);
}

// --- 診断モード エントリポイント ---
export async function launch() {
  try {
    await bootAnimation();

    // Layer 1 / 2: プロンプト A を表示
    const promptA = '(' + fromHex(PHEX.a) + ')?';
    const inputA  = await maskedPrompt(promptA);

    if (inputA === '') {
      // 空エンター -> Layer 3 へ移行
      W(T.dim + T.fGrn);
      await type('\n  >>> Layer 3 認証シーケンス 開始\n', 20);
      await sleep(400);

      const promptB = '(' + fromHex(PHEX.b) + ')?';
      const inputB  = await maskedPrompt(promptB);

      if (hashOf(inputB) === HASH.subuta) {
        await showGranted('supervisor');
      } else {
        await showDenied();
      }
    } else {
      const h = hashOf(inputA);
      if (h === HASH.kawa) {
        await showGranted('general');
      } else if (h === HASH.fujisan) {
        await showGranted('senior');
      } else {
        await showDenied();
      }
    }
  } finally {
    // 画面状態を必ず元に戻す
    W(T.shwCur + T.rst);
  }
}
