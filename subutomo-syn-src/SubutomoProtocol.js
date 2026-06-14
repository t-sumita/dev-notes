/**
 * SubutomoProtocol.js
 *
 * ビット配置（72 bits = 9 bytes）:
 *   [0–34]   name     : 5文字 × 7-bit ASCII = 35 bits
 *   [35–58]  score    : 24 bits（ビッグエンディアン）
 *   [59–62]  level    : 4 bits
 *   [63–70]  checksum : 8-bit HMAC-Lite
 *   [71]     padding  : 0（固定）
 *
 * エンコードパイプライン:
 *   パッキング → ビットインターリーブ（固定置換） → 右循環シフト(score % 8) → Base64 → "QED-XXXX-XXXX-XXXX"
 */

// ─── 定数 ────────────────────────────────────────────────────────────────────

const SECRET_SALT   = "Subutomo_Secret_2026";
const OFFICIAL_SALT = "Subutomo_Official_Seal_2026"; // 落とし戸用ソルト（非公開）

const TOTAL_BITS = 72; // 9バイト

// ─── 固定ビット置換（xorshift シード 0xDEADBEEF で Fisher-Yates シャッフル） ──

const BIT_PERM = (() => {
  const p = Array.from({ length: TOTAL_BITS }, (_, i) => i);
  let s = 0xDEADBEEF >>> 0;
  const rng = () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >> 17)) >>> 0;
    s = (s ^ (s <<  5)) >>> 0;
    return s;
  };
  for (let i = TOTAL_BITS - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
})();

// デコード用の逆置換: inv[j] = BIT_PERM[i] = j となる i
const BIT_PERM_INV = (() => {
  const inv = new Array(TOTAL_BITS);
  BIT_PERM.forEach((src, dst) => { inv[src] = dst; });
  return inv;
})();

// ─── Base64 アルファベット（標準） ───────────────────────────────────────────

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LUT   = Object.fromEntries([...B64_CHARS].map((c, i) => [c, i]));

// ─── ビット操作ユーティリティ ─────────────────────────────────────────────────

// バイト配列のビット i を取得（ビッグエンディアンビット順）
function getBit(bytes, i) {
  return (bytes[i >> 3] >> (7 - (i & 7))) & 1;
}

// バイト配列のビット i に値 v をセット
function setBit(bytes, i, v) {
  const mask = 1 << (7 - (i & 7));
  if (v) bytes[i >> 3] |=  mask;
  else   bytes[i >> 3] &= ~mask;
}

// 置換を適用: result[i] = source[perm[i]]
function applyPerm(bytes, perm) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < perm.length; i++) setBit(out, i, getBit(bytes, perm[i]));
  return out;
}

// total ビットのビット列を n ビット右循環シフト
function rotateRight(bytes, total, n) {
  n = ((n % total) + total) % total;
  if (n === 0) return bytes.slice();
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < total; i++) setBit(out, i, getBit(bytes, (i - n + total) % total));
  return out;
}

// ─── HMAC-Lite（ソルト付き 8-bit 多項式チェックサム） ────────────────────────

function hmacLite(data, salt) {
  let h = 0xAB;
  // ソルトをステートに混入
  for (let i = 0; i < salt.length; i++)  h = ((h ^ salt.charCodeAt(i)) * 0xC3 + 0x7D) & 0xFF;
  // データを処理
  for (let i = 0; i < data.length;  i++)  h = ((h ^ data[i])            * 0x9B + 0x3F) & 0xFF;
  // ファイナライズ
  h = ((h ^ (h >> 4)) * 0xF1) & 0xFF;
  return h;
}

// ─── Base64 エンコード / デコード（3バイト倍数専用、パディングなし） ───────────

function b64Encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    s += B64_CHARS[a >> 2]
      +  B64_CHARS[((a & 3) << 4) | (b >> 4)]
      +  B64_CHARS[((b & 0xF) << 2) | (c >> 6)]
      +  B64_CHARS[c & 0x3F];
  }
  return s;
}

function b64Decode(s) {
  const out = new Uint8Array(Math.floor(s.length * 3 / 4));
  let j = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = B64_LUT[s[i]], b = B64_LUT[s[i + 1]],
          c = B64_LUT[s[i + 2]], d = B64_LUT[s[i + 3]];
    out[j++] = (a << 2) | (b >> 4);
    out[j++] = ((b & 0xF) << 4) | (c >> 2);
    out[j++] = ((c & 3) << 6) | d;
  }
  return out;
}

// ─── パッキング / アンパッキング ──────────────────────────────────────────────

// チェックサム計算用の生バイト列を構築（置換・ローテーション前の値から計算）
function buildChecksumInput(name5, score, level) {
  const raw = new Uint8Array(9);
  for (let i = 0; i < 5; i++) raw[i] = name5.charCodeAt(i) & 0x7F;
  raw[5] = (score >> 16) & 0xFF;
  raw[6] = (score >>  8) & 0xFF;
  raw[7] =  score        & 0xFF;
  raw[8] = level;
  return raw;
}

function packBits(name5, score, level, salt) {
  const checksum = hmacLite(buildChecksumInput(name5, score, level), salt);

  const bytes = new Uint8Array(9); // 72 bits
  let p = 0;

  // name: 5文字 × 7 bits
  for (let i = 0; i < 5; i++) {
    const c = name5.charCodeAt(i) & 0x7F;
    for (let b = 6; b >= 0; b--) setBit(bytes, p++, (c >> b) & 1);
  }
  // score: 24 bits
  for (let b = 23; b >= 0; b--) setBit(bytes, p++, (score >> b) & 1);
  // level: 4 bits
  for (let b =  3; b >= 0; b--) setBit(bytes, p++, (level >> b) & 1);
  // checksum: 8 bits（ビット 63–70）
  for (let b =  7; b >= 0; b--) setBit(bytes, p++, (checksum >> b) & 1);
  // ビット 71: パディング（初期値 0 のまま）

  return bytes;
}

function unpackBits(bytes) {
  let p = 0, name = '';
  for (let i = 0; i < 5; i++) {
    let c = 0;
    for (let b = 6; b >= 0; b--) c |= getBit(bytes, p++) << b;
    name += String.fromCharCode(c);
  }
  let score = 0;
  for (let b = 23; b >= 0; b--) score |= getBit(bytes, p++) << b;
  let level = 0;
  for (let b =  3; b >= 0; b--) level |= getBit(bytes, p++) << b;
  let checksum = 0;
  for (let b =  7; b >= 0; b--) checksum |= getBit(bytes, p++) << b;
  return { name, score, level, checksum };
}

// ─── コアエンコード（ソルトをパラメータ化した内部実装） ───────────────────────

function _encode(name, score, level, salt) {
  if (typeof name !== 'string')
    throw new TypeError('name は文字列である必要があります');
  if (!Number.isInteger(score) || score < 0 || score > 0xFFFFFF)
    throw new RangeError('score は 0〜16777215 の整数（24-bit）である必要があります');
  if (!Number.isInteger(level) || level < 0 || level > 15)
    throw new RangeError('level は 0〜15 の整数（4-bit）である必要があります');

  const name5       = name.padEnd(5, '\0').slice(0, 5);
  const packed      = packBits(name5, score, level, salt);
  const interleaved = applyPerm(packed, BIT_PERM);
  const rotated     = rotateRight(interleaved, TOTAL_BITS, score % 8);
  const b64         = b64Encode(rotated); // 9バイト → 12文字

  return `QED-${b64.slice(0, 4)}-${b64.slice(4, 8)}-${b64.slice(8, 12)}`;
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

/**
 * encode(name, score, level) → "QED-XXXX-XXXX-XXXX"
 *
 * @param {string}  name   最大5文字の ASCII 文字列（5文字未満はヌル文字でパディング）
 * @param {number}  score  0〜16777215 の整数（24-bit）
 * @param {number}  level  0〜15 の整数（4-bit）
 */
export function encode(name, score, level) {
  return _encode(name, score, level, SECRET_SALT);
}

/**
 * decode(code) → { name, score, level, isValid, isOfficial }
 *
 * isValid    : SECRET_SALT で計算したチェックサムと一致する（正規コード）
 * isOfficial : OFFICIAL_SALT で計算したチェックサムと一致する（落とし戸）
 *
 * 検証失敗時は { isValid: false, isOfficial: false, error } を返す。
 */
export function decode(code) {
  if (typeof code !== 'string')
    return { isValid: false, isOfficial: false, error: '入力は文字列である必要があります' };

  // "QED-" プレフィックスとダッシュを除去して Base64 部分を取り出す
  const b64 = code.toUpperCase().startsWith('QED-')
    ? code.slice(4).replace(/-/g, '')
    : code.replace(/-/g, '');

  if (b64.length !== 12 || [...b64].some(c => !(c in B64_LUT)))
    return { isValid: false, isOfficial: false, error: 'フォーマットが不正です' };

  const bytes = b64Decode(b64);

  // score % 8 の候補（0〜7）を全探索してチェックサムで照合
  for (let rot = 0; rot < 8; rot++) {
    const unrotated  = rotateRight(bytes, TOTAL_BITS, TOTAL_BITS - rot);
    const unpermuted = applyPerm(unrotated, BIT_PERM_INV);
    const { name, score, level, checksum } = unpackBits(unpermuted);

    if (score % 8 !== rot) continue;

    const raw         = buildChecksumInput(name, score, level);
    const secretChk   = hmacLite(raw, SECRET_SALT);
    const officialChk = hmacLite(raw, OFFICIAL_SALT);

    const isValid    = checksum === secretChk;
    const isOfficial = checksum === officialChk;

    if (isValid || isOfficial) {
      return {
        name: name.replace(/\0/g, '').trimEnd(),
        score,
        level,
        isValid,
        isOfficial,
      };
    }
  }

  return { isValid: false, isOfficial: false, error: '署名が一致しません' };
}

/**
 * encodeOfficial(name, score, level) → "QED-XXXX-XXXX-XXXX"
 *
 * OFFICIAL_SALT で署名したコードを生成する。
 * decode() は { isOfficial: true } を返す。
 * 本番では非公開にすることを想定（ここではデモ用に export）。
 */
export function encodeOfficial(name, score, level) {
  return _encode(name, score, level, OFFICIAL_SALT);
}
