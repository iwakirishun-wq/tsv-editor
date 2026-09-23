# GAS版 tsv-editor: HPナレッジ突合チェック 設計

作成: 2026-09-24 / Claude Code（司令役）
状態: **実装済み**（末尾「実装の記録」参照）。HPページ本文の取得だけ未了（Basic認証PW待ち）

## 決まっていること

| 項目 | 決定 | 決めた経緯 |
|---|---|---|
| 公開範囲 | `access: MYSELF` / `executeAs: USER_DEPLOYING` | Driveナレッジを読ませるため。ANYONEのままだとURLを知る全員がSHUNのDriveを読める |
| 料金の正本 | **HP抽出データ**（これから整備） | 料金表マスタではなく「HPと食い違っていないか」を見たいため |
| AIへの送信 | 許可済み（Gemini API） | ただし送るのは差分行のみ。TSV全体は送らない |
| HP取得元 | testweb（社内ドメイン） | 公開サイトには27F1のチケットページがまだ無い（`/f1/` はティザーのみ、`/f1/ticket/` は404） |

## 全体像

```
[ローカルPC] testweb巡回 → pages/*.txt → 構造化 → HP料金ナレッジ.json
                                                        │ Driveへ置く
                                                        ▼
[GAS] Code.gs: getHpKnowledge(eventKey) ──────────── Drive読み取り(ID固定・読取のみ)
              askGemini(payload) ─────────────────── Gemini API(差分行のみ)
                    │ google.script.run
                    ▼
[ブラウザ] index.html: 「HP突合チェック」ボタン → 結果パネル
```

GASはGoogleのサーバーで動くので**testwebには到達できない**。HP取得は必ずローカルで行い、成果物をDriveへ置く。

## 正本スキーマ `HP料金ナレッジ.json`

置き場所: `50_OUTPUTS/02_業務成果物/チケット対応コックピット/HP料金ナレッジ.json`
GASからは**ファイルIDを固定**して読む（名前検索は遅く壊れやすい）。IDは Script Properties の `HP_KNOWLEDGE_FILE_ID`。

```json
{
  "schema": "hp_price_knowledge/1",
  "built_at": "2026-09-24T00:00:00+09:00",
  "source": { "site": "testweb", "pages": ["ticket_top.html", "seat_a1.html"] },
  "events": {
    "鈴鹿_27F1": {
      "label": "2027 F1日本グランプリ",
      "sale": {
        "start": "2026-11-01T11:00:00+09:00",
        "rules": [
          { "scope": "指定席・観戦券", "end": "2027-04-25T23:59:00+09:00", "raw": "決勝レース終了まで", "machine_checkable": false }
        ]
      },
      "items": [
        {
          "seat_name": "A1-1観戦券",
          "seat_code": "SF1GPE27011",
          "ticket_name": "大人(24歳以上)",
          "advance": 40000,
          "same_day": null,
          "note": "小学生以上有料",
          "page": "seat_a1.html",
          "confidence": "exact"
        }
      ]
    }
  }
}
```

- `seat_code` はHPには載っていないので、**料金表マスタの席種名から逆引きして付ける**。付けられなければ `null` にして名前照合へ落とす（勝手に推測で埋めない）。
- `confidence`: `exact`（金額が1箇所だけ）/ `conflict`（ページ間で食い違い＝HP側の不備の可能性）/ `missing`（金額欄が空）。
- ページ間で金額が食い違う場合は**片方を採用せず `conflict` として両方残す**。8/21の3軸突合で「トップ一覧と詳細で価格が逆転」が実際に起きているため。

## 3つのチェック

### 1. 販売期間（機械判定）

TSVの `販売開始日時` / `販売終了日時` を `sale.start` / `sale.rules[].end` と突合。

- `machine_checkable: false` のルール（「決勝レース終了まで」等）は**判定せず「要目視」に分類**して一覧に出す。日時に落とせないものを勝手に解釈しない。
- 席種がどの `scope` に当たるかは、scope文字列と席種名のキーワード一致で決める。当たらない席種は「scope未特定」として別枠。

### 2. 料金（機械判定）

TSVの `前売価格` / `当日価格` を `items[].advance` / `same_day` と突合。

- 対応付けは **①席種エリアコード → ②席種名の正規化一致** の順。②で当てた行は「要確認」として必ず出す（黙って合格にしない）。
- 売止めダミー価格（全桁9、F1_2026のみ8埋め）は比較対象外。
- `confidence: conflict` の項目は「HP側が食い違っている」として、TSVの合否とは別枠で出す。

### 3. 備考の抜け

- **(a) 構造的判定（正本不要・いますぐ作れる）**: 同じ配席ブロック／同じ席種グループの他の席種には備考があるのに、この席種だけ空 → 抜けの疑い。
- **(b) HP突合**: `items[].note` があるのにTSV側が空 → 抜け。文言が違うだけかどうかの判定は AI に回す。

## AIに投げる範囲

**機械で白黒つくものはAIに投げない**（毎回答えが変わるため）。

| | 担当 |
|---|---|
| 販売期間の一致 | 機械 |
| 金額の一致 | 機械 |
| 備考の空欄検出 (3a) | 機械 |
| 「この備考とHPの記載は実質同じか」 | AI |
| 機械が拾った差分の説明文 | AI |

Geminiへ送るのは**差分になった行だけ**。TSV全体・ナレッジ全体は送らない。

## GAS側 API

```js
doGet()                      // 既存。index を配信
listHpEvents()               // → [{ key, label, built_at, item_count }]
getHpKnowledge(eventKey)     // → そのイベントぶんだけ（全体2.6MBを返さない）
askGemini({ rows, question })// → Gemini応答。キーは Script Properties の GEMINI_API_KEY
```

制約:
- CacheService は1エントリ100KB、PropertiesService は9KB/件なので、ナレッジ全体はキャッシュに載らない。**サーバ側でイベント単位に絞ってから返す**。
- GASの実行は1回6分上限。
- Driveは**読み取りのみ**。GASから書き込まない。
- APIキーをコードに書かない。`appsscript.json` にも入れない。

## 既知の落とし穴

- **GAS配信で文字列リテラル内の `//` が消える**（2026-09-15にポータルで発生）。URLを文字列に直書きせず、スキーム抜きで持って実行時に組み立てる。現行 index.html は文字列内 `//` が0件であることを確認済み。
- ローカル(file://)で動いても**GAS上で動くとは限らない**。必ず @HEAD デプロイのURLで実物確認する。
- `cdnjs.cloudflare.com` はGASサンドボックスから読めない。外部CDNに依存しない。

## 未了

- HPページ本文の取得（Basic認証PWが要る。ID: `hcttrm`）。このPCからtestwebへは到達可能（401を確認済み＝認証待ち）

---

# 実装の記録（2026-09-24）

状態: **サーバー側・判定ロジック・UIまで実装済み。HPナレッジの中身だけ未整備。**

| 担当 | 成果物 | 状態 |
|---|---|---|
| AGY | `gas/HpCheck.gs`（319行） | 実装済み・Claude検品済み |
| Claude Code | `index.html` の `HP_CHECK_CORE`（判定）＋ UI（リボン「HP突合」・結果ダイアログ） | 実装済み |
| Claude Code | `tests/hp_check.test.js`（47件） | 全パス |
| ― | `HP料金ナレッジ.json` の中身 | **未整備（testwebのBasic認証PW待ち）** |

## 実装で判明して直したこと

実データ（経路価格スケジュール 鈴鹿_27F1 25,319行）で回して、机上では気づかなかった2つの誤りを潰した。

1. **アップグレード行を通常価格と比べていた。**
   UG行の `前売価格` は「席種の値段」ではなく「差額」。HPの席種価格と比べると全部不一致になる。
   実測で **誤検知 24,467件**。`hpIsUgRow()` で除外して解消。
2. **同じ席種×券種が販売経路×会員ランクのぶん重複していた。**
   25,319行に対して実際の組み合わせは396通り。1行ずつ指摘すると同じ内容が数千件並んで読めない。
   `hpCollapse()` でまとめ、`×N行` として件数だけ添えるようにした。

修正後は、フィクスチャに仕込んだ差分（金額ずらし2件・conflict 1件）を**その件数ちょうど**検出する。
判定時間は 25,319行で **32ms**。

## 検証に使ったもの

- フィクスチャ生成: `_検証_20260924/make_hp_fixture.py`
  実データの非UG行から396件のHP料金ナレッジを合成し、わざと差分を仕込む
- UI検証: `_検証_20260924/verify_hp_ui.py`（Playwrightで実データを読ませて判定・描画まで確認）
- 画面: `_検証_20260924/hp_check_result.png`

**フィクスチャは検証専用で、正本ではない。** 本番の `HP料金ナレッジ.json` はHPから作ること。

## 残っていること

1. **testwebのBasic認証PW**（ID: `hcttrm`）。このPCからtestwebへは到達できる（401を確認済み）ので、
   PWさえあればローカルで巡回・抽出できる
2. 抽出したナレッジをDriveへ置き、Script Properties に設定する:

   | キー | 意味 |
   |---|---|
   | `HP_KNOWLEDGE_FILE_ID` | Drive上の `HP料金ナレッジ.json` のファイルID |
   | `GEMINI_API_KEY` | Gemini APIキー |
   | `GEMINI_MODEL` | 省略時 `gemini-2.5-flash` |

3. 販売期間の `scope` 判定は、scope文字列と席種名のキーワード一致という単純な方式。
   実際のHPの書き方を見てから精度を詰める
