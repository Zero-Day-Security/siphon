from __future__ import annotations

import base64
import time
from typing import Any

from mitmproxy import http

from siphon.logging import TrafficLogger
from siphon.proxy.core import FlowStore


def _decode_body(content: bytes | None, content_type: str | None) -> str | None:
    if content is None:
        return None
    if not content:
        return ""
    is_text = content_type and any(
        t in content_type
        for t in ("text/", "json", "xml", "javascript", "html", "css", "form-urlencoded")
    )
    if is_text:
        try:
            return content.decode("utf-8", errors="replace")
        except Exception:
            pass
    return base64.b64encode(content).decode("ascii")


def _headers_dict(headers: http.Headers) -> dict[str, str]:
    return dict(headers.items())


class SiphonAddon:
    def __init__(self, flow_store: FlowStore, logger: TrafficLogger | None = None) -> None:
        self.store = flow_store
        self.logger = logger
        self._pending: dict[str, float] = {}

    def request(self, flow: http.HTTPFlow) -> None:
        req = flow.request
        if self.store._scope_enabled and not self.store.is_in_scope(req.host):
            return
        self._pending[flow.id] = time.time()
        content_type = req.headers.get("content-type", "")
        flow_data: dict[str, Any] = {
            "id": flow.id,
            "timestamp": req.timestamp_start or time.time(),
            "method": req.method,
            "url": req.pretty_url,
            "host": req.host,
            "port": req.port,
            "path": req.path,
            "scheme": req.scheme,
            "request_headers": _headers_dict(req.headers),
            "request_body": _decode_body(req.content, content_type),
            "request_content_type": content_type or None,
            "status_code": None,
            "response_headers": None,
            "response_body": None,
            "response_content_type": None,
            "duration_ms": None,
            "highlighted": False,
            "notes": "",
            "tags": [],
            "evidence_captured": False,
            "source": "proxy",
        }
        self.store.add_flow(flow_data)

    def response(self, flow: http.HTTPFlow) -> None:
        resp = flow.response
        if resp is None:
            return
        if flow.id not in self._pending:
            return

        start = self._pending.pop(flow.id, None)
        duration_ms = round((time.time() - start) * 1000, 1) if start else None

        content_type = resp.headers.get("content-type", "")
        updates: dict[str, Any] = {
            "status_code": resp.status_code,
            "response_headers": _headers_dict(resp.headers),
            "response_body": _decode_body(resp.content, content_type),
            "response_content_type": content_type or None,
            "duration_ms": duration_ms,
        }
        self.store.update_flow(flow.id, updates)
        if self.logger:
            full_flow = self.store.get_flow(flow.id)
            if full_flow:
                self.logger.log_flow(full_flow)
