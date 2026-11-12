from __future__ import annotations

import base64
import defusedxml.ElementTree as ET
from typing import Any
from urllib.parse import urlparse


def flows_to_burp_xml(flows: list[dict[str, Any]]) -> str:
    root = ET.Element("items", burpVersion="2024.0", exportTime=_now_str())
    for flow in flows:
        _add_item(root, flow)
    return '<?xml version="1.0"?>\n' + ET.tostring(root, encoding="unicode")


def burp_xml_to_flows(xml_str: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_str)
    flows = []
    for item in root.findall("item"):
        flows.append(_parse_item(item))
    return flows


def _add_item(root: ET.Element, flow: dict[str, Any]) -> None:
    item = ET.SubElement(root, "item")

    url = flow.get("url", "")
    parsed = urlparse(url)

    _sub(item, "time", _ts_str(flow.get("timestamp", 0)))
    _sub(item, "url", url)
    _sub(item, "host", flow.get("host", ""), ip=flow.get("host", ""))
    _sub(item, "port", str(flow.get("port", 443)))
    _sub(item, "protocol", flow.get("scheme", "https"))
    _sub(item, "method", flow.get("method", "GET"))
    _sub(item, "path", flow.get("path", "/"))
    _sub(item, "extension", _get_extension(flow.get("path", "/")))
    _sub(item, "request", _build_raw_request(flow), base64="true")
    _sub(item, "status", str(flow.get("status_code", "")))
    _sub(item, "responselength", str(_response_length(flow)))
    _sub(item, "mimetype", flow.get("response_content_type", "") or "")
    _sub(item, "response", _build_raw_response(flow), base64="true")
    _sub(item, "comment", flow.get("notes", ""))


def _parse_item(item: ET.Element) -> dict[str, Any]:
    url = _text(item, "url")
    parsed = urlparse(url)

    raw_req = _text(item, "request")
    raw_resp = _text(item, "response")

    is_b64 = item.find("request") is not None and item.find("request").get("base64") == "true"
    if is_b64 and raw_req:
        try:
            raw_req = base64.b64decode(raw_req).decode("utf-8", errors="replace")
        except Exception:
            pass
    if is_b64 and raw_resp:
        try:
            raw_resp = base64.b64decode(raw_resp).decode("utf-8", errors="replace")
        except Exception:
            pass

    req_headers, req_body = _parse_raw_http(raw_req)
    resp_headers, resp_body = _parse_raw_http(raw_resp)

    status_str = _text(item, "status")
    status = int(status_str) if status_str.isdigit() else None

    import uuid
    return {
        "id": str(uuid.uuid4()),
        "timestamp": 0,
        "method": _text(item, "method") or "GET",
        "url": url,
        "host": _text(item, "host") or parsed.hostname or "",
        "port": int(_text(item, "port") or "0") or (443 if parsed.scheme == "https" else 80),
        "path": _text(item, "path") or parsed.path or "/",
        "scheme": _text(item, "protocol") or parsed.scheme or "https",
        "request_headers": req_headers,
        "request_body": req_body,
        "request_content_type": req_headers.get("content-type"),
        "status_code": status,
        "response_headers": resp_headers,
        "response_body": resp_body,
        "response_content_type": resp_headers.get("content-type") or _text(item, "mimetype"),
        "duration_ms": None,
        "highlighted": False,
        "notes": _text(item, "comment"),
        "tags": [],
        "evidence_captured": False,
        "source": "import",
    }


def _build_raw_request(flow: dict[str, Any]) -> str:
    method = flow.get("method", "GET")
    path = flow.get("path", "/")
    headers = flow.get("request_headers") or {}
    body = flow.get("request_body") or ""

    lines = [f"{method} {path} HTTP/1.1"]
    for k, v in headers.items():
        lines.append(f"{k}: {v}")
    raw = "\r\n".join(lines) + "\r\n\r\n" + body
    return base64.b64encode(raw.encode()).decode()


def _build_raw_response(flow: dict[str, Any]) -> str:
    status = flow.get("status_code")
    if status is None:
        return ""
    headers = flow.get("response_headers") or {}
    body = flow.get("response_body") or ""

    lines = [f"HTTP/1.1 {status} OK"]
    for k, v in headers.items():
        lines.append(f"{k}: {v}")
    raw = "\r\n".join(lines) + "\r\n\r\n" + body
    return base64.b64encode(raw.encode()).decode()


def _parse_raw_http(raw: str) -> tuple[dict[str, str], str | None]:
    if not raw:
        return {}, None
    parts = raw.split("\r\n\r\n", 1)
    if len(parts) == 1:
        parts = raw.split("\n\n", 1)
    header_block = parts[0]
    body = parts[1] if len(parts) > 1 else None

    headers: dict[str, str] = {}
    for i, line in enumerate(header_block.split("\n")):
        if i == 0:
            continue
        line = line.strip()
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    return headers, body if body and body.strip() else None


def _sub(parent: ET.Element, tag: str, text: str, **attrs: str) -> None:
    el = ET.SubElement(parent, tag, **attrs)
    el.text = text


def _text(item: ET.Element, tag: str) -> str:
    el = item.find(tag)
    return el.text if el is not None and el.text else ""


def _get_extension(path: str) -> str:
    if "." in path.split("/")[-1]:
        return path.split(".")[-1].split("?")[0][:10]
    return ""


def _response_length(flow: dict[str, Any]) -> int:
    body = flow.get("response_body") or ""
    return len(body.encode()) if body else 0


def _now_str() -> str:
    from datetime import datetime, timezone
    return datetime.now(tz=timezone.utc).strftime("%a %b %d %H:%M:%S UTC %Y")


def _ts_str(ts: float) -> str:
    if not ts:
        return ""
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%a %b %d %H:%M:%S UTC %Y")
