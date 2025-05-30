# Gemini Translation Conference - デプロイメントガイド

## 概要

このシステムは、Gemini APIを使用して日本語とベトナム語の相互翻訳を行うWebRTCベースの会議システムです。

### 主な機能

- **リアルタイム音声翻訳**: 参加者の音声を自動的に検出し、相手の言語に翻訳
- **WebRTC通信**: P2P接続による低遅延の音声通信
- **画面共有**: デスクトップ画面の共有機能
- **多言語対応**: 日本語とベトナム語の相互翻訳

## システム構成

1. **フロントエンド**: React（WebRTC、音声処理、Gemini API呼び出し）
2. **バックエンド**: Cloudflare Worker（WebRTCシグナリング）
3. **API**: Google Gemini API（音声認識と翻訳）

## セットアップ手順

### 1. Gemini API キーの取得

1. [Google AI Studio](https://aistudio.google.com/apikey)にアクセス
2. 新しいAPIキーを作成
3. キーを安全に保管

### 2. Cloudflare Workerのデプロイ

1. Cloudflareアカウントを作成
2. Wranglerをインストール:
   ```bash
   npm install -g wrangler
   ```

3. プロジェクトを初期化:
   ```bash
   wrangler init translation-conference
   cd translation-conference
   ```

4. `src/index.js`にWorkerコードを配置

5. `wrangler.toml`を設定:
   ```toml
   name = "translation-conference"
   main = "src/index.js"
   compatibility_date = "2024-01-01"
   
   [durable_objects]
   bindings = [{name = "ROOMS", class_name = "RoomDurableObject"}]
   
   [[durable_objects.migrations]]
   tag = "v1"
   new_classes = ["RoomDurableObject"]
   ```

6. デプロイ:
   ```bash
   wrangler deploy
   ```

### 3. フロントエンドの統合

1. ReactアプリケーションをビルドしてWorkerに組み込む
2. または、別途静的ホスティングサービスを使用

## 使用方法

### 会議の開始

1. ブラウザでアプリケーションにアクセス
2. Gemini APIキーを入力
3. 使用する言語（日本語/ベトナム語）を選択
4. 「Start Conference」をクリック

### 会議中の操作

- **マイクのミュート/ミュート解除**: マイクボタンをクリック
- **画面共有の開始/停止**: モニターボタンをクリック
- **会議の終了**: 電話終了ボタンをクリック

### 翻訳の仕組み

1. 参加者の音声が自動的にキャプチャされます
2. 無音検出により発話の区切りを判定
3. 音声データをWAV形式に変換
4. Gemini APIに送信して文字起こしと翻訳を実行
5. 翻訳結果が画面に表示されます

## 技術仕様

### WebRTC設定

- STUNサーバー: Google Public STUN servers
- 音声コーデック: Opus（デフォルト）
- データチャンネル: 未使用（音声のみ）

### 音声処理

- サンプリングレート: 48kHz
- ビット深度: 16bit
- チャンネル: モノラル
- 無音検出閾値: 0.01
- バッファサイズ: 4096サンプル

### Gemini API設定

- モデル: gemini-2.0-flash-exp
- 入力形式: WAV（base64エンコード）
- レスポンス形式: JSON

## トラブルシューティング

### 音声が認識されない

- マイクの権限を確認
- ブラウザの設定でマイクへのアクセスを許可
- 音量設定を確認

### 翻訳が表示されない

- Gemini APIキーが正しいか確認
- ネットワーク接続を確認
- ブラウザのコンソールでエラーを確認

### 接続できない

- Cloudflare Workerが正しくデプロイされているか確認
- WebSocketの接続を確認
- ファイアウォール設定を確認

## セキュリティ上の注意

- APIキーは各ユーザーが自分で入力する仕組みのため、サーバー側で保存されません
- WebRTC通信は暗号化されています（DTLS-SRTP）
- 音声データは翻訳処理後に破棄されます

## 制限事項

- 同時接続数はCloudflare Workerの制限に依存
- 長時間の発話は分割される可能性があります
- ネットワーク状況により遅延が発生する場合があります

## カスタマイズ

### 対応言語の追加

Reactアプリケーションの`myLanguage`選択肢と翻訳プロンプトを変更することで、他の言語にも対応可能です。

### UI/UXの改善

Tailwind CSSクラスを使用してデザインをカスタマイズできます。

### 機能拡張

- テキストチャット機能の追加
- 録音機能の実装
- 翻訳履歴のエクスポート機能