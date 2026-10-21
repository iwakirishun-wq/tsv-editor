# 公開手順

TSVエディターの公開先は GitHub Pages と既存のGAS Webアプリの2か所です。正式な公開操作は、リポジトリ直下の `publish.ps1` にまとめています。従来の `gas/deploy.bat` からも同じ両方公開・検証処理を呼びます。

1. 正本の `index.html` を修正し、`powershell -ExecutionPolicy Bypass -File .\publish.ps1 -Prepare` で `gas/index.html` に同期する。
2. 差分を確認し、`node tests/run_all.js` など変更に応じたテストを実行する。
3. 両方のHTMLと関連変更を `main` にコミットする。
4. `powershell -ExecutionPolicy Bypass -File .\publish.ps1` を実行する。

公開スクリプトは、フロントエンドの一致とリリースファイルのコミット済み状態を確認し、GitHubへ通常pushした後、`gas/deploy_target.json` の既存GASデプロイを更新します。共有済みGASのURLは変えません。GitHub Pagesの実際のHTMLと、GASの正式デプロイが参照する不変バージョンのHTMLを取得し、ローカル正本との一致を検証して初めて成功します。GASは本人限定公開のため、匿名HTTPでの画面取得は検証に使いません。

片方の公開や検証が失敗すると、段階と失敗理由を表示して異常終了します。成功と扱わず、原因を解消して同じコマンドを再実行してください。公開処理自体は2サービス間の原子的操作ではありません。

`powershell -ExecutionPolicy Bypass -File .\publish.ps1 -VerifyOnly` は公開せず、現在の両公開先を照合します。GASの認証は既存の `clasp`、GitHubの認証は既存の `git` と `gh` を使用します。認証情報をリポジトリに置かないでください。

`gas/deploy.ps1` はGAS専用の低レベル操作と既存の自動修復から利用するため残しています。通常の機能修正ではGASだけ、GitHubだけを個別公開して完了にせず、上記の一連の手順を使ってください。
