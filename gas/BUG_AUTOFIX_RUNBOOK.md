# GAS 不具合報告から main と既存本番デプロイへの自動反映

## 処理の境界

`BugReport.gs` が本人の Drive に作った各フォルダの `report.json` を、ローカルの Drive 同期フォルダから読み取る。`REPORT.md`、`data.tsv`、スクリーンショットは開かない。モデルに渡すのは報告種別、コメントの先頭 1500 文字、エラー文の一部、ローカルのソース抜粋だけ。本文は未信頼データとして JSON に入れ、命令として扱わない。TSV やスクリーンショット、実業務データはテストにも使わない。

モデルは既にインストールされているローカル Ollama の `qwen3.8:27b` だけを使う。モデルが `ollama list` に無ければ停止し、[Ollama のローカル generate API](https://docs.ollama.com/api/generate) を `127.0.0.1:11434` に固定して `stream: false`、`think: false`、`format: json` で呼ぶ。HTTP プロキシは使用しない。既存の Work / Codex / Claude CLI は外部モデルへの送信境界を保証できないため、この処理経路では使わない。追加の API 課金や第三者サービスは不要。

自動修正の対象は **単一の CSS 表示不具合**に限る。AI は正本のルート `index.html` に対する小さな置換と合成データの回帰テスト、ブラウザの computed style による再現条件を提案する。処理はルートを修正してから `gas/index.html` にバイト単位でコピーする。コードは CSS `<style>` 内、置換は各ファイルで一意、30 行・1800 文字以内、通信・保存・実行系の語を含まない場合だけ採用する。機能ロジック、データ破損の疑い、要望、複数領域、大きな変更、原因が曖昧な報告は `needs_review` とする。これは安全な範囲から開始するための境界であり、他種の不具合が自動修正されるという意味ではない。

## 反映先の根拠

- TSV エディター本体の正本はリポジトリ直下の `index.html`。自動修正はそのファイルを変更し、GitHub `origin/main` に直接通常 push する。GitHub はソース管理先。
- GAS は現行 `gas/deploy.ps1` が正本を `gas/index.html` へ同期し、`gas/deploy_target.json` の正式 deployment ID を `clasp create-deployment -i` で更新する。既存公開 URL を使い、`-New` は使わない。正本が欠落またはコピーが一致しなければ deploy 前に停止する。
- リポジトリに GitHub Pages の workflow または公開設定は確認されていないため、Pages の新設や Pages への反映は対象外。独立した別ホストは設定上の証拠が見つかった時だけ反映先に加え、その設定ファイルと URL を記録する。

## 実行順と停止条件

1. レポート ID、schema、サイズ、report.json のハッシュを検査。同じ内容の重複は `duplicate`。Drive のフォルダは移動・削除しない。
2. 元の checkout が `main` で clean か確認し、`origin/main` を fetch する。clean な main が遅れていれば fast-forward のみ行う。報告外差分、分岐、認証・通信失敗で停止。
3. 各報告専用の Git worktree を作る。既存の `node tests/run_all.js` と、合成データだけを使う `python tests/bug_report_ui_test.py` を修正前に実行。失敗なら停止。夜間 UI チェックは実業務データを参照し得るため実行しない。
4. ローカルモデルの提案を構造とパスで検証。AI が作った Node テストは Node 権限制限、環境変数の最小化、45 秒の制限付きで、**修正前は失敗、修正後は成功**が必須。ブラウザで CSS の computed style も修正前に不一致、修正後に一致することを確かめる。
5. 既存テストを再実行し、変更パスが `index.html`、`gas/index.html`、報告専用 `tests/bug_autofix_*.test.js` のみか、両 HTML が同一か、`git diff --check` と行数制限を確認。検査済みファイルのハッシュを保存する。
6. 許可パスだけコミットする。push 直前に報告内容、元 checkout、専用 worktree、remote の head、既存の認証済みフロント検証用ブラウザー状態を再確認。`git push origin <commit>:refs/heads/main` を通常の fast-forward push として実行し、終了コードと commit SHA を記録。force push はしない。
7. push した commit の専用 worktree から `gas/deploy.ps1 -NonInteractive -Description <一意の印>` を実行する。`deploy_target.json` の正式 ID がコードに固定した既知の ID と一致し、ルート版と GAS 版の `index.html` が同一で、`origin/main` が対象 commit を指している場合だけ進む。既存スクリプトは `clasp push -f` の後に `clasp create-deployment -i <正式ID>` を呼ぶ。`-New` と `-PushOnly` は使わない。既存認証が無ければログインを起動せず停止する。
8. `clasp list-deployments` で同じ正式 ID と一意の印を照合し、既存 URL を認証済み Playwright ブラウザー状態で開く。公開画面の `<style>` が修正後の CSS を含み、修正前には不一致だった computed style が期待値と一致し、GitHub `origin/main` の commit と検査済みのルート/GAS用 HTML のハッシュが一致した場合だけ、ローカル状態を `archived` とする。Drive の元報告は移動・削除しない。確認できない場合は `needs_review`。

状態は `.agents/bug_autofix_runtime/state/<報告IDのハッシュ>.json` に原子的に保存する。`discovered → planned → patched → tested → committed → pushed → deploying → deployed → verified → archived` の各段階で再開できる。`needs_review` は理由と再開段階を記録し、条件を解消して `--retry-needs-review` を指定した時だけ再試行する。push 直後の停止は remote head と commit の一致で復旧する。デプロイ呼び出し直後の停止は `list-deployments` に正式 ID と一意の印が揃う場合だけ復旧し、曖昧な場合は再デプロイせず `needs_review` に留める。フロント検証失敗からの再試行は検証だけ行う。`run.lock` は多重起動を防ぐ。状態ファイルと専用 worktree は Git の ignore 対象で、調査のため自動削除しない。

## 導入と実行

処理順は **report → triage → fix → tests → push main → update existing GAS deployment → verify frontend → archive/report status**。この基盤変更の初回リリースでは、スケジューラ登録、Secrets / credentials の作成・変更、実 Drive への書き込み、実際の push/deploy は行っていない。親の検品後、次の環境確認と初回リリースを行う。

- `main` の clean な checkout と `origin` の fetch / push 権限。Git Credential Manager の既存資格情報が非対話で使えるかを別途確認する。処理中は `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never` なので対話認証はできない。
- `G:\マイドライブ\GASアプリ用データ\TSVエディタ_バグ報告` が同期済みで読み取り可能なこと。実際の保存先は GAS の `BUG_REPORT_FOLDER_ID` 設定とも照合する。
- Node 24、Python 3.12、Playwright Chromium、ローカル Ollama と上記モデル、PowerShell、clasp。`gas/.clasp.json` と既存の clasp 認証が必要。認証ファイルや Secrets はこの作業で作成・変更しない。
- `--frontend-storage-state` で渡せる、既存の認証済み Playwright storage state。GAS Web App は `access=MYSELF` なので、未認証の HTTP 200 や `clasp list-deployments` だけをフロント反映の成功とはしない。状態ファイルは機密情報として管理し、Git に置かず、スクリプトは読み取り専用で使用する。既存状態がない場合は push 前に `needs_review`。

手動の一回実行例:

```powershell
python tools/bug_report_autofix.py --reports 'G:\マイドライブ\GASアプリ用データ\TSVエディタ_バグ報告' --frontend-storage-state '<既存の認証済みstate.json>'
```

条件を直した後の再試行:

```powershell
python tools/bug_report_autofix.py --reports 'G:\マイドライブ\GASアプリ用データ\TSVエディタ_バグ報告' --frontend-storage-state '<既存の認証済みstate.json>' --retry-needs-review
```

標準出力には各 ID、状態、理由、commit、push 結果、既存 URL の要約だけを出す。詳細はローカル state JSON を参照する。`needs_review` の理由は報告者データを含めない。今回の作業ブランチ `fix/selection-visibility` は dirty なので、この時点で実報告を走査しても自動 push には進めない。

### 初回リリースと定時実行

1. 親の検品でこの差分と既存 dirty/untracked ファイルの所有者を確認する。初回リリースは **この基盤変更だけ**を clean な `main` checkout に取り込み、`node tests/run_all.js`、`python tests/bug_report_ui_test.py`、`python tests/bug_report_autofix_test.py`、`git diff --check` を実行する。`origin/main` の fast-forward 関係を確認して通常 push する。既存 dirty ブランチを reset/clean しない。
2. 初回のGAS反映も既存正式 ID/URL のみを対象に、clean な main checkout の `gas` から `deploy.ps1 -NonInteractive` を実行する。`-New` を付けない。`clasp list-deployments` で既存 ID、認証済みブラウザーで既存 URL の UI を確認し、実際に確認できた結果だけ記録する。初回基盤リリースに報告本文は使わない。
3. 既存タスク `TsvEditor_NightlyUiCheck` の Action は `.agents/nightly/nightly_check.ps1` の起動と確認済み。このスクリプトの **失敗通知判定より前**に、clean な main checkout の `tools/bug_report_autofix.py` を呼ぶ数行を追加する方法が最小範囲。タスクの実行アカウントから参照できる `TSV_AUTOFIX_REPO`（clean な main checkout）、`TSV_AUTOFIX_REPORTS`（同期済み報告フォルダ）、`TSV_AUTOFIX_STORAGE_STATE`（既存の認証済みstate）を先に確認し、絶対パスで `python <repo>/tools/bug_report_autofix.py --repo <repo> --reports <reports> --frontend-storage-state <state>` を実行する。終了コードが非ゼロなら既存の `$exitCode` を `1` にして失敗通知へ渡す。既存 UI チェックの処理は変更せず、重複起動は `run.lock` が止める。他タスクや広範な OS 設定は変更しない。ただし **既存タスクの直近結果が `1`** のため、先にその失敗原因を調べ、正常起動できる状態にしてから組み込む。
4. 組み込み後は `Get-ScheduledTask -TaskName TsvEditor_NightlyUiCheck` と `Get-ScheduledTaskInfo -TaskName TsvEditor_NightlyUiCheck` で Action、Trigger、State、LastRunTime、LastTaskResult、NextRunTime と、ローカル state JSON/実行ログを照合する。`needs_review`、認証失敗、デプロイ失敗は成功扱いしない。今回はタスク設定を変更していないため、組み込み後の状態は未確認。

## 合成データでの確認

`python tests/bug_report_autofix_test.py` は一時ディレクトリに bare remote、main checkout、報告フォルダを作る。合成報告で main push、既存正式 ID の deploy 呼び出し、フロント検証と archive、重複、dirty checkout、既存テスト失敗、修正前に通ってしまうテスト、未信頼コメント、通信を加える危険な差分、push 失敗と再開、デプロイ応答の欠落と照合、曖昧なデプロイの停止、フロント検証のみの再試行、誤った正式 ID の停止、修正後のテスト失敗、部分パッチからの再開、報告の途中変更を検査する。実 Drive、GitHub、GAS には接続しない。

## 今回の検証記録（2026-10-03）

- `python tests/bug_report_autofix_test.py` — 18 件成功。一時 bare remote への main push と、既存 ID の deploy/フロント確認をモックで検証。
- ローカル Ollama `qwen3.8:27b` — 合成プロンプトでローカル generate API が JSON を返すことを確認。実報告は投入していない。
- `node tests/run_all.js` — 全 7 スイート成功。
- `python tests/bug_report_ui_test.py` — 成功。合成データのみ。
- `git diff --check` — exit 0。既存の dirty ファイルに改行形式の警告は出るが、空白エラーはない。新規 3 ファイルも末尾空白を別途検査して成功。
- GitHub `origin/main` への通信・認証・push、GAS の実デプロイ、認証済み既存 URL の UI 反映は未確認。既存 OS タスク `TsvEditor_NightlyUiCheck` は登録済みで Ready、毎日 03:00 起動、2026-10-03 03:00 の直近結果は `1`、次回予定は 2026-10-04 03:00 と読み取り確認した。原因調査と組み込み後の確認は未了。今回の基盤変更は現在の dirty な `fix/selection-visibility` に残し、push / deploy していない。
