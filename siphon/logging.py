from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class TrafficLogger:
    def __init__(self, log_dir: str | Path) -> None:
        self._log_dir = Path(log_dir)
        self._log_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d_%H%M%S")
        self._log_file = self._log_dir / f"siphon_{ts}.jsonl"
        self._lock = threading.Lock()
        self._count = 0

    @property
    def log_dir(self) -> Path:
        return self._log_dir

    @property
    def log_path(self) -> Path:
        return self._log_file

    @property
    def flow_count(self) -> int:
        return self._count

    def log_flow(self, flow_data: dict[str, Any]) -> None:
        record = {
            "logged_at": time.time(),
            "flow": flow_data,
        }
        line = json.dumps(record, default=str) + "\n"
        with self._lock:
            with open(self._log_file, "a") as f:
                f.write(line)
            self._count += 1

    def load_session(self, path: str | Path) -> list[dict[str, Any]]:
        flows = []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                flows.append(record["flow"])
        return flows

    def list_sessions(self) -> list[dict[str, Any]]:
        sessions = []
        for p in sorted(self._log_dir.glob("siphon_*.jsonl"), reverse=True):
            stat = p.stat()
            line_count = sum(1 for _ in open(p))
            sessions.append({
                "filename": p.name,
                "path": str(p),
                "size_bytes": stat.st_size,
                "flow_count": line_count,
                "modified": stat.st_mtime,
            })
        return sessions
