# 月報管理アプリ 引き継ぎガイド

## 概要

ドライバーが月報（紙）をスマートフォンで撮影してLINEから提出し、事務員がダッシュボードでOCR結果を確認・確定する業務システム。

- **ドライバー側**: LINE LIFF アプリ（`docs/index.html`）
- **事務員側**: 管理ダッシュボード（`docs/staff/index.html`）、GitHub Pages でホスティング
- **バックエンド**: Google Apps Script (GAS) Web App（`CODE.gs` 等）
- **データ**: Google Spreadsheet + Google Drive

---

## アーキテクチャ

```
LINE LIFF
  └─ docs/js/app.js
       └─ POST → GAS Web App (doPost)
                    ├─ Code.gs        … ドライバーAPI・Drive保存
                    ├─ OcrService.gs  … Claude API OCR
                    ├─ Dashboard.gs   … 事務員API
                    └─ Setup.gs       … 初回セットアップ用

GitHub Pages (docs/)
  ├─ index.html + js/app.js          … LIFF（ドライバー）
  └─ staff/index.html + js/dashboard.js … ダッシュボード（事務員）
```

---

## ファイル構成

| ファイル | 役割 |
|---------|------|
| `Code.gs` | doPost ルーティング、ドライバー認証、Drive保存、月報受信 |
| `Dashboard.gs` | 事務員API（一覧・OCR詳細・修正保存・月次確定・CSV出力）、GIS認証 |
| `OcrService.gs` | Claude API 呼び出し、OCR結果パース・シート書き込み |
| `Setup.gs` | setupSheets()（初回・スキーマ変更後に実行）|
| `appsscript.json` | GAS設定（executeAs: USER_DEPLOYING, access: ANYONE_ANONYMOUS）|
| `docs/index.html` | LIFF HTML |
| `docs/js/app.js` | LIFF JavaScript |
| `docs/staff/index.html` | ダッシュボード HTML |
| `docs/staff/js/dashboard.js` | ダッシュボード JavaScript |
| `docs/staff/css/dashboard.css` | ダッシュボード CSS |

---

## Google Spreadsheet シート構成

**SHEET_ID**: `1vPSbmyEUov0-hasJ9YVqggt2ClP9Blx8Do1zqlb8chc`

### 月報受信ファイル
```
[0]タイムスタンプ [1]LINEユーザーID [2]ドライバー名 [3]現場名 [4]年月
[5]ファイル種別  [6]DriveファイルID [7]DriveURL     [8]ステータス
[9]OCR実行日時  [10]同意           [11]同意日時     [12]備考テキスト
[13]アップロードID [14]フォルダURL
```
ステータス値: `未処理` → `確認待ち` → `確定` / `OCRエラー`

### OCR結果データ
```
[0]LINEユーザーID [1]ドライバー名 [2]現場名 [3]年月 [4]日
[5]開始時間       [6]終了時間    [7]稼働フラグ(bool) [8]確認ステータス
[9]修正後開始時間 [10]修正後終了時間 [11]受信ファイルID [12]アップロードID
```
確認ステータス値: `未確認` → `修正済み`

### ドライバーマスタ
```
[0]LINEユーザーID [1]ドライバー名 [2]現場名 [3]単価(税別)
[4]基準拘束時間(分) [5]休憩時間(分)
```
複数現場対応: 同一LINEユーザーIDで複数行可（現場別）

### 月次確定
```
[0]LINEユーザーID [1]ドライバー名 [2]現場名 [3]年月
[4]稼働日数 [5]実働時間合計(分) [6]超過時間合計(分)
[7]単価 [8]請求金額 [9]確定日時
```

### 立替明細
```
[0]LINEユーザーID [1]ドライバー名 [2]現場名 [3]年月
[4]行番号 [5]区分 [6]金額 [7]内容 [8]受信ファイルID [9]アップロードID
```

### 添付ファイル
```
[0]タイムスタンプ [1]LINEユーザーID [2]ドライバー名 [3]現場名 [4]年月
[5]インデックス  [6]ファイル名      [7]DriveファイルID [8]DriveURL [9]アップロードID
```

### 操作ログ
```
[0]日時 [1]操作者メール [2]操作種別 [3]LINEユーザーID
[4]ドライバー名 [5]年月 [6]変更前 [7]変更後 [8]補足
```

---

## Google Drive フォルダ構成

**DRIVE_FOLDER_ID**: `1T9j-k7DY5DGwscHQQlhIkEEE4uggQGXR`

```
月報フォルダ（ルート）/
  └─ 2026-06/
       └─ 山田太郎_渋谷センター/   ← {ドライバー名}_{現場名}（現場なしは名前のみ）
            ├─ {uploadId}_report_2026-06.jpg
            └─ {uploadId}_添付1_....jpg
```

---

## GAS デプロイ情報

- **デプロイID**: `AKfycbxhBY8vJ74CzghhEfnZi1QitH1U0qeOFfQ-aEG8Z9bfIchXqHLDBF3BEmFEKdSma3dJTw`
- **URL**: `https://script.google.com/macros/s/{上記ID}/exec`
- **設定**: `executeAs: USER_DEPLOYING`、`access: ANYONE_ANONYMOUS`
- コード変更後は GAS エディタで「デプロイを管理」→「新バージョンで編集」→保存

---

## Script Properties（必須設定）

GAS エディタ → プロジェクトの設定 → スクリプトプロパティ

| キー | 内容 |
|-----|------|
| `CLAUDE_API_KEY` | Claude API キー（OCR用）|
| `OAUTH_CLIENT_ID` | `882266271532-67lvpq4lk25qgr9npdt4f1n0o07afuq1.apps.googleusercontent.com` |
| `ALLOWED_EMAILS` | ダッシュボードアクセス許可メール（カンマ区切り・小文字・スペースなし）|

事務員を追加するときは `ALLOWED_EMAILS` にメールを追記するだけでよい。

---

## GCP プロジェクト設定

**プロジェクト番号**: `882266271532`

有効化が必要なAPI:
- Google Sheets API
- Google Drive API ← **忘れやすい。有効化しないとDrive操作が全断する**
- （LINE LIFF は別途LINE Developersコンソールで設定）

OAuth クライアント（ダッシュボード用）:
- 種別: ウェブアプリケーション
- 承認済みJavaScriptオリジン: GitHub Pages の URL を登録

---

## 初回セットアップ手順

1. GAS エディタで Script Properties を設定
2. GCP コンソールで Drive API を有効化
3. GAS エディタで `setupSheets()` を実行 → シート・ヘッダー自動生成
4. ドライバーマスタに行を追加（LINEユーザーID・名前・現場・単価）
5. LINE Developers で LIFF URL を設定

スキーマ変更後（列追加等）も `setupSheets()` を再実行する。

---

## 定期的な操作

### ドライバー追加
→ ドライバーマスタに行を追加するだけ

### 事務員追加
→ Script Properties の `ALLOWED_EMAILS` にメールを追記

### コード変更後のデプロイ
1. GAS エディタでコードを編集・保存
2. 「デプロイを管理」→「鉛筆アイコン（編集）」→「バージョン: 新バージョン」→「デプロイ」
3. フロント（docs/ 配下）を変更した場合は `git push origin main`（GitHub Pages 自動更新）
4. ブラウザキャッシュ回避のため HTML 内の `?v=YYYYMMDDX` を更新する

---

## 既知の注意点・落とし穴

### Sheets の数値→Date 自動変換
大きな整数（請求金額など）をシートに書くと Sheets が Date 型に変換することがある。
GAS で読み出すときは `sheetValueToNumber_()` を通す。

### GAS の `silent` パラメータ
`handleSaveCorrection(silent)` を `addEventListener('click', handleSaveCorrection)` で渡すと
`silent` に MouseEvent が入り `!!MouseEvent = true` になる。
**必ず `function() { handleSaveCorrection(false); }` でラップすること。**

### Drive API 認証
GCPカスタムプロジェクトに切り替えた際、Drive API を GCP コンソールで明示的に有効化しないと
DriveApp が全断する（Sheets は動いていても Drive だけ止まる）。

### フォルダURL
アップロード時に `SHEET_RECEIVED[14]` にフォルダURL を保存する設計（2026-06-15〜）。
旧データ（[14] が空）は `getMonthDriverFolderUrls_()` でフォールバックするが、
Drive API が切れていると空になる。

### GAS コールドスタート
5分以上アクセスがないとインスタンスが停止し、次のリクエストが3〜4秒かかる（仕様）。

---

## 残タスク

- `docs/js/app.js` の `TAG_REDIRECT_URL`（先頭付近）に L ステップの流入URL を設定（URL確定後）
- GitHub Org 移管後、GCP コンソールの OAuth クライアントに新オリジン URL を追加登録
- Script Properties から `ADMIN_TOKEN` を削除（旧認証の残骸）

---

## 関連リンク

- GAS エディタ: https://script.google.com（プロジェクト名: ReportUploadApp または類似）
- GitHub リポジトリ: https://github.com/wad-apps/Report-Upload-App
- Google Spreadsheet: https://docs.google.com/spreadsheets/d/1vPSbmyEUov0-hasJ9YVqggt2ClP9Blx8Do1zqlb8chc
- Google Drive フォルダ: https://drive.google.com/drive/folders/1T9j-k7DY5DGwscHQQlhIkEEE4uggQGXR
