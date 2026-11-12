from __future__ import annotations

import asyncio
import fnmatch
import threading
import time
import uuid
from typing import Any


class FlowStore:
    def __init__(self) -> None:
        self._flows: dict[str, dict[str, Any]] = {}
        self._flow_order: list[str] = []
        self._evidence: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._subscribers: list[asyncio.Queue] = []
        self._sub_lock = threading.Lock()
        self._scope: list[str] = []
        self._scope_enabled: bool = False

    def add_flow(self, flow: dict[str, Any]) -> None:
        with self._lock:
            flow_id = flow["id"]
            self._flows[flow_id] = flow
            self._flow_order.append(flow_id)
        self._notify({"type": "new_flow", "data": flow})

    def update_flow(self, flow_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            if flow_id not in self._flows:
                return None
            self._flows[flow_id].update(updates)
            flow = dict(self._flows[flow_id])
        self._notify({"type": "update_flow", "data": flow})
        return flow

    def get_flow(self, flow_id: str) -> dict[str, Any] | None:
        with self._lock:
            flow = self._flows.get(flow_id)
            return dict(flow) if flow else None

    def get_flows(
        self,
        host: str | None = None,
        method: str | None = None,
        status_code: int | None = None,
        search: str | None = None,
        limit: int = 500,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        with self._lock:
            result = []
            for fid in reversed(self._flow_order):
                flow = self._flows[fid]
                if host and host.lower() not in flow.get("host", "").lower():
                    continue
                if method and flow.get("method", "").upper() != method.upper():
                    continue
                if status_code is not None and flow.get("status_code") != status_code:
                    continue
                if search:
                    needle = search.lower()
                    haystack = " ".join([
                        flow.get("url", ""),
                        flow.get("request_body", "") or "",
                        flow.get("response_body", "") or "",
                    ]).lower()
                    if needle not in haystack:
                        continue
                result.append(flow)

            total = len(result)
            page = result[offset : offset + limit]
            return [{"total": total, "flows": [dict(f) for f in page]}][0]

    def clear(self) -> None:
        with self._lock:
            self._flows.clear()
            self._flow_order.clear()
        self._notify({"type": "clear", "data": {}})

    def toggle_highlight(self, flow_id: str) -> bool | None:
        with self._lock:
            flow = self._flows.get(flow_id)
            if not flow:
                return None
            flow["highlighted"] = not flow.get("highlighted", False)
            val = flow["highlighted"]
        self._notify({"type": "update_flow", "data": self.get_flow(flow_id)})
        return val

    def set_notes(self, flow_id: str, notes: str) -> bool:
        with self._lock:
            flow = self._flows.get(flow_id)
            if not flow:
                return False
            flow["notes"] = notes
        self._notify({"type": "update_flow", "data": self.get_flow(flow_id)})
        return True

    def add_evidence(self, evidence: dict[str, Any]) -> None:
        with self._lock:
            self._evidence[evidence["id"]] = evidence

    def get_evidence(self, evidence_id: str) -> dict[str, Any] | None:
        with self._lock:
            ev = self._evidence.get(evidence_id)
            return dict(ev) if ev else None

    def list_evidence(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(e) for e in reversed(self._evidence.values())]

    def set_scope(self, patterns: list[str]) -> None:
        with self._lock:
            self._scope = [p.strip().lower() for p in patterns if p.strip()]

    def get_scope(self) -> dict[str, Any]:
        with self._lock:
            return {"enabled": self._scope_enabled, "patterns": list(self._scope)}

    def set_scope_enabled(self, enabled: bool) -> None:
        with self._lock:
            self._scope_enabled = enabled

    def is_in_scope(self, host: str) -> bool:
        with self._lock:
            if not self._scope:
                return True
            h = host.lower()
            for pattern in self._scope:
                if fnmatch.fnmatch(h, pattern):
                    return True
            return False

    def get_sitemap(self) -> list[dict[str, Any]]:
        with self._lock:
            hosts: dict[str, dict[str, Any]] = {}
            for fid in self._flow_order:
                flow = self._flows[fid]
                h = flow.get("host", "")
                if not h:
                    continue
                if h not in hosts:
                    hosts[h] = {
                        "host": h,
                        "flow_count": 0,
                        "paths": set(),
                        "methods": set(),
                        "first_seen": flow.get("timestamp", 0),
                        "last_seen": flow.get("timestamp", 0),
                    }
                entry = hosts[h]
                entry["flow_count"] += 1
                entry["paths"].add(flow.get("path", "/"))
                entry["methods"].add(flow.get("method", "?"))
                ts = flow.get("timestamp", 0)
                if ts < entry["first_seen"]:
                    entry["first_seen"] = ts
                if ts > entry["last_seen"]:
                    entry["last_seen"] = ts

            result = []
            scope_patterns = list(self._scope)
            for h, entry in sorted(hosts.items()):
                in_scope = True
                if scope_patterns:
                    in_scope = any(fnmatch.fnmatch(h.lower(), p) for p in scope_patterns)
                result.append({
                    "host": entry["host"],
                    "flow_count": entry["flow_count"],
                    "paths": sorted(entry["paths"]),
                    "methods": sorted(entry["methods"]),
                    "first_seen": entry["first_seen"],
                    "last_seen": entry["last_seen"],
                    "in_scope": in_scope,
                })
            return result

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
