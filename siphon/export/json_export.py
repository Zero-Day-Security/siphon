from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any


def flows_to_json(flows: list[dict[str, Any]], indent: int = 2) -> str:
    export = {
        "version": "1.0",
        "tool": "Siphon",
        "exported_at": datetime.now(tz=timezone.utc).isoformat(),
        "flow_count": len(flows),
        "flows": flows,
    }
    return json.dumps(export, indent=indent, default=str)
