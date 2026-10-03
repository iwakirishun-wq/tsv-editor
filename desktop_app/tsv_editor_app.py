# -*- coding: utf-8 -*-
"""
チケットTSVエディター (Desktop EXE版 - デバッグ＆永続化対応)
------------------------------------------------------------
【改修内容】
1. デバッグモード有効化: F12キーや右クリックでDevTools（開発者ツール）が起動可能
2. 固定ポート運用 (49152): 起動ごとにポートが変わるのを防ぎ、localStorage（設定・マーカー色・ヘッダー辞書）を完全永続化
3. ユーザーデータフォルダ固定: %LOCALAPPDATA%/TSVEditor_Data にキャッシュとストレージを永続保管
"""

import os
import sys
import socket
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webview

DEFAULT_PORT = 49152

def get_base_dir():
    if hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent

def get_data_dir():
    app_data = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    data_path = Path(app_data) / "TSVEditor_Data"
    data_path.mkdir(parents=True, exist_ok=True)
    return str(data_path)

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

def run_server(base_dir, target_port=DEFAULT_PORT):
    port = target_port if not is_port_in_use(target_port) else 0
    handler = partial(QuietHandler, directory=str(base_dir))
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    actual_port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, actual_port

def main():
    base_dir = get_base_dir()
    server, port = run_server(base_dir, DEFAULT_PORT)
    url = f"http://127.0.0.1:{port}/index.html"

    data_dir = get_data_dir()
    webview.settings['USER_AGENT'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 TSVEditorDesktop'

    window = webview.create_window(
        title="チケットTSVエディター [Desktop Edition] (F12で開発者ツール起動可能)",
        url=url,
        width=1320,
        height=860,
        min_size=(960, 600),
        text_select=True,
        confirm_close=True
    )

    webview.start(
        gui='edgechromium',
        debug=True,
        storage_path=data_dir
    )

if __name__ == '__main__':
    main()
