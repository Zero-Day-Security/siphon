from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from siphon.beacon.server import BeaconStore
from siphon.proxy.core import FlowStore

PROJECT_VERSION = "1.0"


def save_project(
    flow_store: FlowStore,
    beacon_store: BeaconStore | None = None,
) -> str:
    data = flow_store.get_flows(limit=100_000)
    flows = data["flows"] if isinstance(data, dict) else data

    project: dict[str, Any] = {
        "version": PROJECT_VERSION,
        "tool": "Siphon",
        "saved_at": datetime.now(tz=timezone.utc).isoformat(),
        "flows": flows,
        "evidence": flow_store.list_evidence(),
        "scope": flow_store.get_scope(),
        "beacon": {
            "tokens": beacon_store.list_tokens() if beacon_store else [],
            "interactions": beacon_store.get_all_interactions() if beacon_store else [],
        },
    }
    return json.dumps(project, indent=2, default=str)


def load_project(
    project_json: str,
    flow_store: FlowStore,
    beacon_store: BeaconStore | None = None,
    merge: bool = False,
) -> dict[str, int]:
    project = json.loads(project_json)

    if not merge:
        flow_store.clear()
        if beacon_store:
            beacon_store.clear()

    flows = project.get("flows", [])
    for f in flows:
        flow_store.add_flow(f)

    evidence = project.get("evidence", [])
    for ev in evidence:
        flow_store.add_evidence(ev)

    scope = project.get("scope", {})
    if scope.get("patterns"):
        flow_store.set_scope(scope["patterns"])
    if scope.get("enabled") is not None:
        flow_store.set_scope_enabled(scope["enabled"])

    beacon = project.get("beacon", {})
    if beacon_store:
        for tok in beacon.get("tokens", []):
            beacon_store.import_token(tok)
        for ix in beacon.get("interactions", []):
            beacon_store.import_interaction(ix)

    return {
        "flows": len(flows),
        "evidence": len(evidence),
        "beacon_tokens": len(beacon.get("tokens", [])),
        "beacon_interactions": len(beacon.get("interactions", [])),
    }
