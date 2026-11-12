from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse, parse_qs


def flows_to_har(flows: list[dict[str, Any]]) -> dict[str, Any]:
    entries = [_flow_to_entry(f) for f in flows]
    return {
        "log": {
            "version": "1.2",
            "creator": {"name": "Siphon", "version": "0.1.0"},
            "entries": entries,
        }
    }


def flows_to_har_json(flows: list[dict[str, Any]], indent: int = 2) -> str:
    return json.dumps(flows_to_har(flows), indent=indent, default=str)


def _flow_to_entry(flow: dict[str, Any]) -> dict[str, Any]:
    ts = flow.get("timestamp", 0)
    started = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    duration_ms = flow.get("duration_ms") or 0

    request = _build_request(flow)
    response = _build_response(flow)

    return {
        "startedDateTime": started,
        "time": duration_ms,
        "request": request,
        "response": response,
        "cache": {},
        "timings": {"send": 0, "wait": duration_ms, "receive": 0},
        "comment": flow.get("notes", ""),
    }


def _build_request(flow: dict[str, Any]) -> dict[str, Any]:
    url = flow.get("url", "")
    method = flow.get("method", "GET")
    headers = _dict_to_nv(flow.get("request_headers") or {})
    cookies = _extract_cookies(flow.get("request_headers") or {})

    parsed = urlparse(url)
    qs = parse_qs(parsed.query, keep_blank_values=True)
    query_string = [{"name": k, "value": v[0]} for k, v in qs.items()]

    body = flow.get("request_body")
    post_data: dict[str, Any] | None = None
    if body:
        ct = flow.get("request_content_type", "")
        post_data = {"mimeType": ct or "", "text": body}

    req: dict[str, Any] = {
        "method": method,
        "url": url,
        "httpVersion": "HTTP/1.1",
        "cookies": cookies,
        "headers": headers,
        "queryString": query_string,
        "headersSize": -1,
        "bodySize": len(body.encode()) if body else 0,
    }
    if post_data:
        req["postData"] = post_data
    return req


def _build_response(flow: dict[str, Any]) -> dict[str, Any]:
    status = flow.get("status_code")
    if status is None:
        return {
            "status": 0,
            "statusText": "",
            "httpVersion": "HTTP/1.1",
            "cookies": [],
            "headers": [],
            "content": {"size": 0, "mimeType": ""},
            "redirectURL": "",
            "headersSize": -1,
            "bodySize": 0,
        }

    headers = _dict_to_nv(flow.get("response_headers") or {})
    body = flow.get("response_body") or ""
    ct = flow.get("response_content_type") or ""

    resp_headers = flow.get("response_headers") or {}
    redirect_url = ""
    for k, v in resp_headers.items():
        if k.lower() == "location":
            redirect_url = v
            break

    cookies = _extract_set_cookies(resp_headers)

    return {
        "status": status,
        "statusText": _status_text(status),
        "httpVersion": "HTTP/1.1",
        "cookies": cookies,
        "headers": headers,
        "content": {
            "size": len(body.encode()) if body else 0,
            "mimeType": ct,
            "text": body,
        },
        "redirectURL": redirect_url,
        "headersSize": -1,
        "bodySize": len(body.encode()) if body else 0,
    }


def _dict_to_nv(d: dict[str, str]) -> list[dict[str, str]]:
    return [{"name": k, "value": v} for k, v in d.items()]


def _extract_cookies(headers: dict[str, str]) -> list[dict[str, str]]:
    for k, v in headers.items():
        if k.lower() == "cookie":
            cookies = []
            for pair in v.split(";"):
                pair = pair.strip()
                eq = pair.find("=")
                if eq > 0:
                    cookies.append({"name": pair[:eq], "value": pair[eq + 1:]})
            return cookies
    return []


def _extract_set_cookies(headers: dict[str, str]) -> list[dict[str, str]]:
    cookies = []
    for k, v in headers.items():
        if k.lower() == "set-cookie":
            parts = v.split(";")
            nv = parts[0].strip()
            eq = nv.find("=")
            if eq > 0:
                cookies.append({"name": nv[:eq], "value": nv[eq + 1:]})
    return cookies


_STATUS_TEXTS = {
    200: "OK", 201: "Created", 204: "No Content",
    301: "Moved Permanently", 302: "Found", 304: "Not Modified",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
    404: "Not Found", 405: "Method Not Allowed",
    500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
}


def _status_text(code: int) -> str:
    return _STATUS_TEXTS.get(code, "")
