# subutomo-syn

**SubutomoProtocol — ビットインターリーブ符号化ライブラリ + CLI 診断モード**

> ⚠️ **ステータス: つくりかけ（プロトタイプ止まり）**
> 2026年5月上旬に [qed-arcade](https://github.com/t-sumita/qed-arcade) の管理者モード
> （SubutomoProtocol + 診断認証）を単体で開発・テストするために作った作業場。
> ライブラリ部分は `qed-arcade/js/lib/SubutomoProtocol.js` にコピーされ、
> 以降は **qed-arcade 側が本流**として独自進化している（`packRankings` /
> `unpackRankings` / `verifyPack` などは qed 側にのみ存在）。
> このリポジトリへの逆輸入・同期は行っていない。

## 元々の構想（メモ）

ゲーム系プロジェクト共通の**管理画面（メンテナンス/診断コンソール）**として
切り出して使い回す発想があった。例：

- スコアコードの発行・検証（QED コード）を複数ゲームで共通化
- 合言葉ベースの階層型認証（一般保守員 → 上級保守員 → スーパーバイザー）を
  共通の「隠し管理メニュー」として提供

→ 実際には qed-arcade 専用の実装のまま中断。共通化・パッケージ化（npm 公開等）は未着手。

## 中身

| ファイル | 役割 |
|---|---|
| `src/SubutomoProtocol.js` | コアライブラリ。name(5文字×7bit) + score(24bit) + level(4bit) + HMAC-Lite 署名(8bit) を 72bit にパッキング → ビット置換(xorshift シード 0xDEADBEEF) → score%8 の右循環シフト → Base64 → `QED-XXXX-XXXX-XXXX` 形式のコードを生成/復元 |
| `src/main.js` | レトロ端末風メニュー CLI。エンコード/デコード、「その他」メニューの隠しコマンド `[D]` で診断モードへ |
| `src/DiagnosticMode.js` | 隠し診断モード。合言葉を SHA-256 ハッシュ照合する階層型認証（正解文字列はソースに残さない難読化方式） |
| `test.js` | ライブラリのテスト一式（フォーマット検証、ラウンドトリップ等） |

### 署名の2系統（落とし戸）

- `SECRET_SALT` … 通常コード → `decode()` が `isValid: true`
- `OFFICIAL_SALT` … 公式シール用 → `decode()` が `isOfficial: true`（`encodeOfficial()` で生成）

## 使い方

```bash
npm start    # CLI 起動（メニュー: [1]エンコード [2]デコード [9]その他 [0]終了）
npm test     # テスト実行
```

## qed-arcade との関係（重要）

- 取り込み: 2026/05/06 頃、`SubutomoProtocol.js` を `qed-arcade/js/lib/` へコピー
- qed 側での追加機能: ランキングのパック/アンパック（`subutomo.html` の QR スキャナ、
  `maintenance_scanner.html`、`MaintenanceUI.js` の管理者モードで使用）
- 診断モードの合言葉認証も qed 側の `MaintenanceUI.js` に移植済み

**プロトコルを変更する場合は qed-arcade 側を直すこと。ここは原型の保管用。**
