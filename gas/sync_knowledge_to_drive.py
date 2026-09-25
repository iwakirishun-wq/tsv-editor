"""Google Drive への HP料金ナレッジ.json アップロード & 接続スクリプト。

~/.clasprc.json の既存認証を利用し、生成された HP料金ナレッジ.json を
Google Drive に新規作成または既存更新して fileId を取得します。
GASの HP_KNOWLEDGE_FILE_ID に設定すべき ID を特定・案内します。

※機密保持方針: トークン・認証情報はファイルやログに出力しません。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

def _find_main_root() -> Path:
    cur = Path(__file__).resolve().parent
    for p in [cur, *cur.parents]:
        if (p / "50_OUTPUTS").exists() and (p / "20_KNOWLEDGE").exists():
            return p
    return Path(r"C:\Users\test\MAIN")

MAIN_ROOT = _find_main_root()
DEFAULT_FILE = (
    MAIN_ROOT / "50_OUTPUTS" / "02_業務成果物" / "チケット対応コックピット" / "HP料金ナレッジ.json"
)



def get_clasp_token() -> str:
    """~/.clasprc.json から access_token を取得（必要ならリフレッシュ）。"""
    clasprc_path = Path(os.environ.get("USERPROFILE", "")) / ".clasprc.json"
    if not clasprc_path.exists():
        raise FileNotFoundError(
            f"clasp 認証ファイルが見つかりません: {clasprc_path}\n"
            "先に 'clasp login' を実行して認証を完了してください。"
        )

    try:
        data = json.loads(clasprc_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise RuntimeError(f"clasp 認証ファイルの読み取りに失敗しました: {e}")

    tokens = data.get("tokens", {})
    token_entry = tokens.get("default", tokens)

    access_token = token_entry.get("access_token")
    refresh_token = token_entry.get("refresh_token")
    client_id = token_entry.get("client_id")
    client_secret = token_entry.get("client_secret")
    expiry_date = token_entry.get("expiry_date", 0)

    # 有効期限チェック (現在時刻ミリ秒 > expiry_date - 60秒)
    now_ms = datetime.now().timestamp() * 1000
    if (not access_token or now_ms > (expiry_date - 60000)) and refresh_token and client_id and client_secret:
        # トークンをリフレッシュ
        token_url = "https://oauth2.googleapis.com/token"
        payload = urllib.parse.urlencode({
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }).encode("utf-8")
        req = urllib.request.Request(token_url, data=payload, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                ref_data = json.loads(resp.read().decode("utf-8"))
                access_token = ref_data.get("access_token")
                new_expiry = now_ms + (ref_data.get("expires_in", 3600) * 1000)
                token_entry["access_token"] = access_token
                token_entry["expiry_date"] = new_expiry
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"トークンのリフレッシュに失敗しました (HTTP {e.code}): {err_body}")

    if not access_token:
        raise ValueError("有効な access_token が取得できませんでした。clasp login を再実行してください。")

    return access_token


def search_existing_file(token: str, filename: str) -> dict | None:
    """Drive上で指定名の既存ファイルを検索。"""
    query = f"name = '{filename}' and trashed = false"
    url = f"https://www.googleapis.com/drive/v3/files?q={urllib.parse.quote(query)}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size)&pageSize=5"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            files = res.get("files", [])
            if len(files) > 1 or res.get("nextPageToken"):
                raise ValueError("同名ファイルが複数あります。--file-id で更新対象を指定してください。")
            return files[0] if files else None
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Drive ファイル検索に失敗しました (HTTP {e.code}): {err_msg}")


def upload_new_file(token: str, filepath: Path, filename: str) -> dict:
    """Driveにファイルを新規作成 (multipart)。"""
    content_bytes = filepath.read_bytes()
    boundary = "-------BOUNDARY_HP_KNOWLEDGE_UPLOAD"
    metadata = {
        "name": filename,
        "mimeType": "application/json",
        "description": "TSVエディタ HPナレッジ突合チェック用データ (hp_price_knowledge/1)",
    }

    body = (
        f"--{boundary}\r\n"
        f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{json.dumps(metadata)}\r\n"
        f"--{boundary}\r\n"
        f"Content-Type: application/json\r\n\r\n"
    ).encode("utf-8") + content_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size"
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/related; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Drive ファイル作成に失敗しました (HTTP {e.code}): {err_msg}")


def update_existing_file(token: str, file_id: str, filepath: Path) -> dict:
    """Drive上の既存ファイルの中身を更新 (media upload)。"""
    content_bytes = filepath.read_bytes()
    url = f"https://www.googleapis.com/upload/drive/v3/files/{file_id}?uploadType=media&fields=id,name,modifiedTime,size"
    req = urllib.request.Request(
        url,
        data=content_bytes,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Content-Length": str(len(content_bytes)),
        },
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Drive ファイル更新に失敗しました (HTTP {e.code}): {err_msg}")


def sync_to_drive(file_path: Path, check_only: bool = False, file_id: str | None = None) -> dict:
    """DriveへHPナレッジを同期。"""
    if not file_path.exists():
        raise FileNotFoundError(f"アップロード対象ファイルが存在しません: {file_path}")

    # JSON構文・スキーマ簡易確認
    data = json.loads(file_path.read_text(encoding="utf-8"))
    if data.get("schema") != "hp_price_knowledge/1":
        raise ValueError(f"無効なスキーマです: {data.get('schema')}")

    token = get_clasp_token()
    filename = file_path.name

    existing = {"id": file_id, "name": filename} if file_id else search_existing_file(token, filename)

    if check_only:
        return {
            "status": "checked",
            "exists": existing is not None,
            "file": existing,
        }

    if existing:
        file_id = existing["id"]
        res = update_existing_file(token, file_id, file_path)
        if res.get("id") != file_id:
            raise ValueError("Drive更新結果のIDが一致しません")
        action = "updated"
    else:
        res = upload_new_file(token, file_path, filename)
        action = "created"

    verify_url = f"https://www.googleapis.com/drive/v3/files/{res['id']}?alt=media"
    req = urllib.request.Request(verify_url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as response:
        if response.read() != file_path.read_bytes():
            raise ValueError("Driveへ保存した内容がローカルファイルと一致しません")

    return {
        "status": "success",
        "action": action,
        "file_id": res["id"],
        "name": res["name"],
        "size": res.get("size"),
        "modified_time": res.get("modifiedTime"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", help="対象JSONファイルパス (省略時は既定のHP料金ナレッジ.json)")
    parser.add_argument("--check", action="store_true", help="接続確認のみ行う")
    parser.add_argument("--file-id", help="更新対象の固定DriveファイルID")
    args = parser.parse_args()

    target = Path(args.file) if args.file else DEFAULT_FILE
    try:
        res = sync_to_drive(target, check_only=args.check, file_id=args.file_id)
        if args.check:
            print("[INFO] Google Drive 接続確認: 成功")
            if res.get("exists"):
                print(f"  - 既存ファイル発見: ID={res['file']['id']}, name={res['file']['name']}")
            else:
                print("  - Drive上に既存ファイルはありません（新規作成可能）")
        else:
            print(f"[SUCCESS] Drive 同期完了 ({res['action']})")
            print(f"  - ファイル名: {res['name']}")
            print(f"  - ファイルID: {res['file_id']}")
            print(f"  - 更新日時:   {res['modified_time']}")
            print("")
            print("================================================================")
            print("【GAS接続手順】")
            print(f"GASの Script Properties に以下を設定してください:")
            print(f"  キー:   HP_KNOWLEDGE_FILE_ID")
            print(f"  値:     {res['file_id']}")
            print("GASエディタのプロジェクト設定から上記スクリプトプロパティを保存してください。")
            print("================================================================")
    except Exception as e:
        print(f"[ERROR] Drive 連携処理に失敗しました: {e}", file=sys.stderr)
        print("", file=sys.stderr)
        print("【不足権限または設定手順】", file=sys.stderr)
        print("  1. clasp 認証で Google Drive スコープが不足している場合:", file=sys.stderr)
        print("     `clasp login` を実行し、ブラウザで Google Drive へのアクセス権を承認してください。", file=sys.stderr)
        print("  2. Google Drive 上に直接手動で 'HP料金ナレッジ.json' をアップロードし、", file=sys.stderr)
        print("     そのファイルIDを GAS の HP_KNOWLEDGE_FILE_ID に設定することも可能です。", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
