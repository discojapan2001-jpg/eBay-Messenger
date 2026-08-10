# eBay自動メッセージ管理ツール - 引き継ぎブリーフィング

## 構成
- **フロントエンド**: `index.html`(単一ファイル、ビルド不要のバニラJS)
  - GitHub Pagesで公開中: https://discojapan2001-jpg.github.io/eBay-Messenger/
  - リポジトリ: https://github.com/discojapan2001-jpg/eBay-Messenger
- **バックエンド**: `Code.gs`(Google Apps Script)
  - eBay Trading API(GetMemberMessages, AddMemberMessageRTQ, GetBestOffers, RespondToBestOffer)との通信
  - Claude APIでの翻訳(日→英、英→日)
  - スプレッドシートでのデータ保存(EbayMessages, EbayOffers, EbayBuyerNotes, EbayTemplates の4シート)
  - Web AppとしてデプロイしJSON APIを公開(doGet: action=state / doPost: 各種操作)

## eBay認証
- 旧来のAuth'n'Auth方式(App ID / Dev ID / Cert ID / eBayAuthToken)
- **重要**: このトークンは在庫管理ツール「Tooliz」と共有している。片方で再認証するともう片方が同時に無効化される(過去に実際発生)。追加キーセットの申請はeBayから却下済み(サポートチケットが必要と案内されたが未提出)
- オファー機能は当初「全出品にGetBestOffersを呼ぶ」方式で実装したが、出品数が多い(3000点規模)とAPI呼び出し過多でトークン無効化を誘発したため、**Gmail通知(「buyer sent a new offer」メール)をトリガーに該当商品1件だけAPIを呼ぶ方式に変更済み**

## 現状動いている機能
- eBayメッセージの自動取得(15分おきポーリング)+自動日本語訳
- 返信欄:日本語入力→英訳→確認→送信ボタンでeBayへ実送信(AddMemberMessageRTQ、実装済みだが実地テスト未実施)
- オファーの通知(Gmail経由)・承諾/却下(実際にeBayへ送信される)
- リピーター購入者のメモ管理
- 返信テンプレートの追加・削除(英語本文を保存)

## 既知の課題
1. ~~テンプレート送信フローが未接続~~ → **実装済み**(2026-08-10)。各メッセージの返信欄に「📋 テンプレート」ボタンを追加。クリックでテンプレ一覧のピッカーモーダルが開き、選択すると確認ダイアログ→`send_reply`(text=テンプレ英文を直接指定、翻訳ステップをスキップ)でeBayへ送信し、`save_reply`でreplyEnとして保存、ステータスを「完了」に更新。`index.html`のUIレベルで動作確認済み(バックエンド未接続のため実地送信は未検証)。実装箇所: `renderMessages()`内の`useTemplateBtn`、`onOpenTemplatePicker`/`onPickTemplate`関数、`#templatePickerOverlay`モーダル
2. **AddMemberMessageRTQの実地テスト未実施**: 買い手に実際に届くか、スレッドが正しく紐づくか(ItemID/ParentMessageIDの扱い)は未確認(テンプレ送信もこの経路を通るため合わせて要検証)
3. **「売れた」通知は未実装**: 注文確定の通知取得は今回のスコープ外のまま
4. **オファー機能もGmail方式に切り替えたばかりで実地テスト未実施**

## 次にやること(優先順)
1. AddMemberMessageRTQの実地テスト(通常返信・テンプレ送信の両方)
2. Gmail経由オファー通知の実地テスト
3. (必要なら)ClaudeCodeでのGit管理・GAS clasp等を使ったデプロイ自動化

## 引き継ぎ時の作業イメージ
- リポジトリをclone: `git clone https://github.com/discojapan2001-jpg/eBay-Messenger.git`
- Code.gsは現状手動でGASエディタにコピペ運用(clasp未導入)。導入すれば `clasp push` で反映できるようになる
