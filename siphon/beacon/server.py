from __future__ import annotations

import asyncio
import io
import secrets
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from typing import Any

TRACKING_PIXEL = (
    b"\x47\x49\x46\x38\x39\x61\x01\x00\x01\x00\x80\x00\x00"
    b"\xff\xff\xff\x00\x00\x00\x21\xf9\x04\x00\x00\x00\x00"
    b"\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02"
    b"\x44\x01\x00\x3b"
)


MAX_INTERACTIONS = 10000


class BeaconStore:
    def __init__(self, base_url: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self._tokens: dict[str, dict[str, Any]] = {}
        self._interactions: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._subscribers: list[asyncio.Queue] = []
        self._sub_lock = threading.Lock()

    def generate_token(self, description: str = "") -> dict[str, Any]:
        token = secrets.token_hex(6)
        record = {
            "id": str(uuid.uuid4()),
            "token": token,
            "description": description,
            "created_at": time.time(),
            "payload_url": f"{self.base_url}/{token}" if self.base_url else token,
            "interaction_count": 0,
        }
        with self._lock:
            self._tokens[token] = record
        return dict(record)

    def record_interaction(self, token: str, interaction: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            tok = self._tokens.get(token)
            if not tok:
                return None
            if len(self._interactions) >= MAX_INTERACTIONS:
                oldest = next(iter(self._interactions))
                del self._interactions[oldest]
            interaction["id"] = str(uuid.uuid4())
            interaction["token"] = token
            interaction["timestamp"] = time.time()
            self._interactions[interaction["id"]] = interaction
            tok["interaction_count"] = tok.get("interaction_count", 0) + 1
        self._notify({"type": "interaction", "data": dict(interaction)})
        return dict(interaction)

    def get_token(self, token: str) -> dict[str, Any] | None:
        with self._lock:
            tok = self._tokens.get(token)
            return dict(tok) if tok else None

    def list_tokens(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(t) for t in reversed(self._tokens.values())]

    def get_interactions(self, token: str) -> list[dict[str, Any]]:
        with self._lock:
            return [
                dict(i) for i in reversed(self._interactions.values())
                if i["token"] == token
            ]

    def get_all_interactions(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(i) for i in reversed(self._interactions.values())]

    def get_interaction(self, interaction_id: str) -> dict[str, Any] | None:
        with self._lock:
            i = self._interactions.get(interaction_id)
            return dict(i) if i else None

    def import_token(self, record: dict[str, Any]) -> None:
        with self._lock:
            self._tokens[record["token"]] = dict(record)

    def import_interaction(self, interaction: dict[str, Any]) -> None:
        with self._lock:
            self._interactions[interaction["id"]] = dict(interaction)

    def clear(self) -> None:
        with self._lock:
            self._tokens.clear()
            self._interactions.clear()

    def delete_token(self, token: str) -> bool:
        with self._lock:
            if token not in self._tokens:
                return False
            del self._tokens[token]
            to_remove = [k for k, v in self._interactions.items() if v["token"] == token]
            for k in to_remove:
                del self._interactions[k]
            return True

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        with self._sub_lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        with self._sub_lock:
            try:
                self._subscribers.remove(q)
            except ValueError:
                pass

    def _notify(self, event: dict[str, Any]) -> None:
        with self._sub_lock:
            dead: list[asyncio.Queue] = []
            for q in self._subscribers:
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    dead.append(q)
            for q in dead:
                try:
                    self._subscribers.remove(q)
                except ValueError:
                    pass


def _make_handler(store: BeaconStore) -> type:
    class BeaconHandler(BaseHTTPRequestHandler):
        def _handle(self) -> None:
            path = self.path
            parts = path.strip("/").split("/", 1)
            token = parts[0] if parts and parts[0] else ""

            body = b""
            content_length = self.headers.get("Content-Length")
            if content_length:
                try:
                    length = min(int(content_length), 65536)
                    body = self.rfile.read(length)
                except Exception:
                    pass

            if token and store.get_token(token):
                headers = {k: v for k, v in self.headers.items()}
                interaction = {
                    "source_ip": self.client_address[0],
                    "method": self.command,
                    "path": path,
                    "headers": headers,
                    "body": body.decode("utf-8", errors="replace") if body else "",
                    "query_string": path.split("?", 1)[1] if "?" in path else "",
                    "protocol": "http",
                }
                store.record_interaction(token, interaction)

            if self.headers.get("Accept", "").startswith("image/"):
                self.send_response(200)
                self.send_header("Content-Type", "image/gif")
                self.send_header("Content-Length", str(len(TRACKING_PIXEL)))
                self.end_headers()
                self.wfile.write(TRACKING_PIXEL)
            else:
                self.send_response(200)
                self.send_header("Content-Length", "0")
                self.end_headers()

        def do_GET(self) -> None:
            self._handle()

        def do_POST(self) -> None:
            self._handle()

        def do_PUT(self) -> None:
            self._handle()

        def do_DELETE(self) -> None:
            self._handle()

        def do_PATCH(self) -> None:
            self._handle()

        def do_HEAD(self) -> None:
            self._handle()

        def do_OPTIONS(self) -> None:
            self._handle()

        def log_message(self, format: str, *args: Any) -> None:
            pass

    return BeaconHandler


class _ThreadingBeaconServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    request_queue_size = 64


def start_beacon_server(store: BeaconStore, host: str, port: int) -> threading.Thread:
    handler = _make_handler(store)
    handler.timeout = 10
    server = _ThreadingBeaconServer((host, port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread
