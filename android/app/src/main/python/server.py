import asyncio
import json
import mimetypes
import os
import re
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from telethon import TelegramClient

CLIENT = None
LOOP = None
CHANNEL = None
TPDB_TOKEN = ""
PORT = 8765

def _start_loop():
    global LOOP
    LOOP = asyncio.new_event_loop()
    asyncio.set_event_loop(LOOP)
    LOOP.run_forever()

def _run(coro):
    return asyncio.run_coroutine_threadsafe(coro, LOOP).result()

def _ensure_client(api_id, api_hash, phone, session_dir):
    global CLIENT, LOOP
    if LOOP is None:
        threading.Thread(target=_start_loop, daemon=True).start()
        while LOOP is None:
            pass

    if CLIENT is None:
        session = os.path.join(session_dir, "telegram")
        CLIENT = TelegramClient(session, int(api_id), api_hash, loop=LOOP)

    async def connect():
        await CLIENT.connect()
        if not await CLIENT.is_user_authorized():
            await CLIENT.send_code_request(phone)
            return False
        return True

    return _run(connect())

def send_code(api_id, api_hash, phone, code_unused, session_dir):
    ok = _ensure_client(api_id, api_hash, phone, session_dir)
    return "Code sent. Enter the Telegram code and press Login." if not ok else "Already logged in."

def login(api_id, api_hash, phone, code, session_dir):
    global CLIENT
    _ensure_client(api_id, api_hash, phone, session_dir)

    async def do_login():
        if await CLIENT.is_user_authorized():
            return True
        await CLIENT.sign_in(phone=phone, code=code)
        return True

    try:
        _run(do_login())
        return "Telegram login successful."
    except Exception as e:
        return "Login error: " + str(e)

def clean_title(name):
    name = os.path.splitext(name or "")[0]
    name = re.sub(r"[._]+", " ", name)
    name = re.sub(r"\[[^]]*\]|\([^)]*\)", " ", name)
    name = re.sub(r"\b(1080p|720p|2160p|4k|x265|x264|HEVC|H265|H264|WEBRip|BluRay)\b", " ", name, flags=re.I)
    name = re.sub(r"\s+", " ", name).strip()
    return name

def tpdb(title):
    if not TPDB_TOKEN:
        return {}
    try:
        q = urllib.parse.quote(clean_title(title))
        req = urllib.request.Request(
            f"https://api.theporndb.net/scenes?parse={q}&limit=1",
            headers={"Authorization": f"Bearer {TPDB_TOKEN}"}
        )
        with urllib.request.urlopen(req, timeout=12) as r:
            data = json.loads(r.read().decode("utf-8"))
        items = data.get("data") or data.get("results") or []
        return items[0] if items else {}
    except Exception:
        return {}

def media_messages():
    async def get():
        entity = await CLIENT.get_entity(CHANNEL)
        out = []
        async for msg in CLIENT.iter_messages(entity, limit=1000):
            if msg.media and getattr(msg, "document", None):
                doc = msg.document
                mime = getattr(doc, "mime_type", "") or ""
                if mime.startswith("video/"):
                    name = next(
                        (a.file_name for a in getattr(doc, "attributes", [])
                         if hasattr(a, "file_name")), None
                    ) or f"Telegram {msg.id}"
                    out.append((msg.id, name, int(getattr(doc, "size", 0) or 0), mime))
        return out
    return _run(get())

def get_message(message_id):
    async def get():
        entity = await CLIENT.get_entity(CHANNEL)
        return await CLIENT.get_messages(entity, ids=message_id)
    return _run(get())

def meta_for(message_id, base):
    msg = get_message(message_id)
    if not msg:
        return None
    doc = msg.document
    name = next(
        (a.file_name for a in getattr(doc, "attributes", [])
         if hasattr(a, "file_name")), None
    ) or f"Telegram {message_id}"
    info = tpdb(name)
    title = info.get("title") or clean_title(name)
    poster = info.get("poster") or info.get("image") or info.get("thumbnail")
    if poster and not str(poster).startswith("http"):
        poster = None
    return {
        "id": f"tg:{message_id}",
        "type": "movie",
        "name": title,
        "description": info.get("description") or name,
        "poster": poster,
        "background": poster,
        "posterShape": "poster",
        "behaviorHints": {"adult": True},
        "streams": [{
            "name": title,
            "title": name,
            "url": f"{base}/file/{message_id}",
            "behaviorHints": {"notWebReady": True}
        }]
    }

class Handler(BaseHTTPRequestHandler):
    def send_json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        global CHANNEL
        u = urllib.parse.urlparse(self.path)
        path = u.path
        q = urllib.parse.parse_qs(u.query)
        base = f"http://{self.server.server_address[0]}:{PORT}"

        if path == "/" :
            return self.send_json({"ok": True, "name": "Happy Local Host", "manifest": f"{base}/manifest.json"})

        if path == "/manifest.json":
            return self.send_json({
                "id": "com.akshay.happylocal",
                "version": "1.0.0",
                "name": "Happy Local Host",
                "description": "Private Telegram media hosted on Android",
                "resources": ["catalog", "meta", "stream"],
                "types": ["movie"],
                "idPrefixes": ["tg:"],
                "catalogs": [{
                    "type": "movie",
                    "id": "happy-movies",
                    "name": "Happy Movies",
                    "extra": [
                        {"name": "search", "isRequired": False},
                        {"name": "skip", "isRequired": False}
                    ]
                }],
                "behaviorHints": {"adult": True, "p2p": False}
            })

        if path.startswith("/catalog/movie/happy-movies"):
            search = (q.get("search") or [""])[0].lower()
            skip = int((q.get("skip") or ["0"])[0])
            rows = media_messages()
            if search:
                rows = [x for x in rows if search in x[1].lower() or search in clean_title(x[1]).lower()]
            metas = []
            for mid, name, size, mime in rows[skip:skip+100]:
                info = tpdb(name)
                poster = info.get("poster") or info.get("image") or info.get("thumbnail")
                metas.append({
                    "id": f"tg:{mid}",
                    "type": "movie",
                    "name": info.get("title") or clean_title(name),
                    "poster": poster,
                    "posterShape": "poster"
                })
            return self.send_json({"metas": metas})

        m = re.match(r"^/meta/movie/tg:(\d+)\.json$", path)
        if m:
            return self.send_json({"meta": meta_for(int(m.group(1)), base)})

        m = re.match(r"^/stream/movie/tg:(\d+)\.json$", path)
        if m:
            meta = meta_for(int(m.group(1)), base)
            return self.send_json({"streams": meta.get("streams", []) if meta else []})

        m = re.match(r"^/file/(\d+)$", path)
        if m:
            return self.stream_file(int(m.group(1)))

        self.send_json({"error": "Not found"}, 404)

    def stream_file(self, message_id):
        msg = get_message(message_id)
        if not msg or not msg.document:
            return self.send_json({"error": "Telegram file not found"}, 404)

        size = int(getattr(msg.document, "size", 0) or 0)
        mime = getattr(msg.document, "mime_type", None) or "application/octet-stream"
        range_header = self.headers.get("Range")
        start, end = 0, size - 1

        if range_header:
            m = re.match(r"bytes=(\d*)-(\d*)", range_header)
            if not m:
                self.send_response(416); self.end_headers(); return
            if m.group(1):
                start = int(m.group(1))
            if m.group(2):
                end = int(m.group(2))
            else:
                end = size - 1

        length = end - start + 1
        self.send_response(206 if range_header else 200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        if range_header:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()

        async def download():
            remaining = length
            async for chunk in CLIENT.iter_download(
                msg.media, offset=start, request_size=512 * 1024
            ):
                if not chunk:
                    continue
                if len(chunk) > remaining:
                    chunk = chunk[:remaining]
                self.wfile.write(chunk)
                self.wfile.flush()
                remaining -= len(chunk)
                if remaining <= 0:
                    break

        try:
            _run(download())
        except Exception:
            pass

def start_server(session_dir, channel, tpdb_token, port=8765):
    global CHANNEL, TPDB_TOKEN, PORT
    CHANNEL = channel
    TPDB_TOKEN = tpdb_token or ""
    PORT = int(port)
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    httpd.serve_forever()
