# パート出勤簿 & 扶養ライン見える化

- **公開デモ**: https://keijisuetsugu.github.io/part-attendance-system/
- **リポジトリ**: https://github.com/KeijiSuetsugu/part-attendance-system

## 概要
ブラウザだけで動く出勤簿アプリです。スタッフごとのカレンダー入力、祝日自動反映、月次集計・年収見込み、扶養ライン（103/106/130万円）進捗、カスタム進捗バー、CSV/Excel出力などを備えています。データは **各ブラウザの localStorage にのみ保存** され、サーバー送信は行いません。

## 主な機能
- スタッフタブ（追加/削除/並び替え）
- 出勤/休みトグル＋小数時間入力（0.25=15分）
- 一括操作：月全体/平日/土日/祝日、時間一括入力、**前月→今月コピー**
- 月次合計・年収見込み（今月×12 / 月平均×残り月）
- 扶養ライン進捗（103/106/130）＋**カスタム進捗A/B（自由入力）**
- 祝日API自動取得（holidays-jp / Nager.Date、キャッシュ付）
- 年間サマリー（各月×金額/時間）
- CSV出力（BOM付）／**Excel(.xlsx)出力**（CDNフォールバックあり）

## 使い方（ローカル）
1. 本リポジトリをダウンロード（ `Code → Download ZIP` ）  
2. ZIPを解凍して `index.html` をダブルクリック  
   → ブラウザでそのまま動作します（Chrome/Edge/Safari/Firefox想定）

## 使い方（GitHub Pages）
1. Settings → Pages → Deploy from a branch → `main` / `root` → Save  
2. 表示された `https://...github.io/...` を共有すればOK

## ファイル構成

/
├── index.html # 画面と読み込み
├── style.css # 見た目
├── script.js # ロジック（localStorage / 祝日API / 出力 など）
└── docs/
└── report.md # 調査レポート（同梱版）

## 動作要件
- 近年のブラウザ（Chrome/Edge/Safari/Firefox）
- ネット接続（初回の祝日取得とExcel出力ライブラリ用CDNに使用、接続不可でもCSVは出力可能）

## セキュリティ/プライバシー
- 入力データは**端末のブラウザ（localStorage）にのみ保存**。サーバー送信なし
- 共有PCでの利用時は「全データ初期化」を利用 or ブラウザのサイトデータ削除を推奨
- 公開版では個人名ではなく**スタッフID**などの識別子利用を推奨
- 祝日API/CDNへのアクセスが発生（ドメイン: `holidays-jp.github.io`, `date.nager.at`, `cdn.jsdelivr.net`, `unpkg.com`）

### 任意: コンテンツセキュリティポリシー（CSP）
`<head>` に次を追加すると外部先を限定できます（必要に応じて調整）。
```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://unpkg.com; connect-src 'self' https://holidays-jp.github.io https://date.nager.at; style-src 'self' 'unsafe-inline'; img-src 'self' data:;">

---

## C. 調査レポート雛形（`docs/report.md` にコピペ）

```md
# 調査レポート（業務効率化：パート勤怠 & 扶養ライン見える化）

## 1. 背景と課題
- パート雇用で「103/106/130万円」等の扶養ラインに収めたいニーズが強い
- 現状の紙/Excel管理では月次の調整が煩雑、人的ミスが起きやすい

## 2. 目標
- ブラウザだけで誰でも使える出勤簿
- 入力と同時に月次合計・年収見込み・扶養到達度が一目で分かる
- CSV/Excel出力で既存フローとも連携可能

## 3. 解決アプローチ（システム構成）
- フロントエンドのみ（HTML/CSS/JS）
- データ保存：localStorage（端末内保存）
- 祝日：holidays-jp API → フォールバックで Nager.Date
- 出力：CSV（BOM付）／Excel：SheetJS（CDN→unpkg フォールバック）

## 4. 主な機能一覧
- スタッフ管理（追加/削除/並び替え）、月選択、出勤/休みトグル、時間入力
- 一括操作（全日/平日/土日/祝日、時間一括、前月コピー）
- 月次集計・年収見込み（今月×12／平均×残り月）
- 扶養進捗（103/106/130）＋カスタムA/B
- 年間サマリー（各月×金額・時間）
- CSV/Excel 出力

## 5. セキュリティ・プライバシー配慮
- 個人データは端末内保存のみ（サーバー送信なし）
- 共有端末では初期化運用を推奨、個人名の代わりにID利用
- 外部通信先は祝日APIとCDNのみ（CSPで制限可能）

## 6. 導入・運用方法
- GitHub Pages 公開で配布（URLアクセスで利用開始）
- 社内配布向けに ZIP リリースも提供可（オフライン動作可・祝日APIのみ要ネット）

## 7. 効果（想定）
- 入力→見込み→調整が1画面で完結、集計/出力手間を削減
- 扶養超過リスクの早期察知

## 8. 残課題 / 拡張余地
- （任意）ユーザー認証、暗号化エクスポート、ロール権限、サーバー保存版
- （任意）オフライン祝日データの同梱モード

## 9. スケジュール
- 企画～実装：○○日
- 提出予定：**2025-10-31（予定）**

## 10. 参考
- holidays-jp / Nager.Date / SheetJS など
