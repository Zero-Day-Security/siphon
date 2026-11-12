from __future__ import annotations

import json
import tempfile
import time
import uuid
from html import escape
from pathlib import Path
from typing import Any


def capture_evidence(flow_data: dict[str, Any], notes: str = "") -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "flow_id": flow_data["id"],
        "timestamp": time.time(),
        "url": flow_data.get("url", ""),
        "method": flow_data.get("method", ""),
        "status_code": flow_data.get("status_code"),
        "notes": notes,
        "request_summary": _summarize_request(flow_data),
        "response_summary": _summarize_response(flow_data),
    }


def _summarize_request(flow: dict[str, Any]) -> str:
    parts = [f"{flow.get('method', '?')} {flow.get('url', '?')}"]
    body = flow.get("request_body")
    if body:
        parts.append(f"Body: {body[:200]}{'...' if len(body) > 200 else ''}")
    return "\n".join(parts)


def _summarize_response(flow: dict[str, Any]) -> str:
    status = flow.get("status_code")
    if status is None:
        return "No response"
    parts = [f"Status: {status}"]
    body = flow.get("response_body")
    if body:
        parts.append(f"Body: {body[:200]}{'...' if len(body) > 200 else ''}")
    return "\n".join(parts)


def _format_body(body: str | None, content_type: str | None, max_len: int = 4000) -> str:
    if not body:
        return '<span class="empty">(empty)</span>'
    if content_type and "json" in content_type:
        try:
            parsed = json.loads(body)
            formatted = json.dumps(parsed, indent=2)
            if len(formatted) > max_len:
                formatted = formatted[:max_len] + "\n... (truncated)"
            return escape(formatted)
        except (json.JSONDecodeError, TypeError):
            pass
    if len(body) > max_len:
        body = body[:max_len] + "\n... (truncated)"
    return escape(body)


def _format_headers(headers: dict[str, str] | None) -> str:
    if not headers:
        return '<span class="empty">(none)</span>'
    return "\n".join(f"{escape(k)}: {escape(v)}" for k, v in headers.items())


def render_evidence_html(evidence: dict[str, Any], flow_data: dict[str, Any]) -> str:
    from datetime import datetime, timezone

    ts = datetime.fromtimestamp(evidence["timestamp"], tz=timezone.utc).strftime(
        "%Y-%m-%d %H:%M:%S UTC"
    )

    method = escape(flow_data.get("method", "?"))
    url = escape(flow_data.get("url", "?"))
    status = flow_data.get("status_code", "—")
    duration = flow_data.get("duration_ms")
    duration_str = f"{duration}ms" if duration else "—"

    status_class = "status-info"
    if isinstance(status, int):
        if 200 <= status < 300:
            status_class = "status-ok"
        elif 300 <= status < 400:
            status_class = "status-redirect"
        elif 400 <= status < 500:
            status_class = "status-client-err"
        elif status >= 500:
            status_class = "status-server-err"

    notes_section = ""
    if evidence.get("notes"):
        notes_section = f"""
        <div class="section">
            <div class="section-title">Notes</div>
            <div class="notes">{escape(evidence["notes"])}</div>
        </div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Evidence — {method} {url}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ background: #0d1117; color: #c9d1d9; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; font-size: 13px; padding: 24px; }}
.card {{ background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; max-width: 900px; margin: 0 auto; }}
.header {{ background: #1c2129; padding: 16px 20px; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }}
.method {{ font-weight: 700; color: #58a6ff; font-size: 14px; }}
.url {{ color: #c9d1d9; word-break: break-all; flex: 1; }}
.badge {{ padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }}
.status-ok {{ background: #1b4332; color: #52c41a; }}
.status-redirect {{ background: #3b2e00; color: #d4a017; }}
.status-client-err {{ background: #3b1c1c; color: #f85149; }}
.status-server-err {{ background: #4a1010; color: #ff6b6b; }}
.status-info {{ background: #1c2333; color: #58a6ff; }}
.meta {{ color: #8b949e; font-size: 11px; }}
.section {{ border-top: 1px solid #30363d; }}
.section-title {{ background: #1c2129; padding: 8px 20px; font-weight: 600; color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }}
.section-body {{ padding: 12px 20px; }}
pre {{ white-space: pre-wrap; word-break: break-all; line-height: 1.5; }}
.empty {{ color: #484f58; font-style: italic; }}
.notes {{ color: #d2a8ff; padding: 12px 20px; white-space: pre-wrap; }}
.footer {{ border-top: 1px solid #30363d; padding: 10px 20px; color: #484f58; font-size: 11px; text-align: right; }}
</style>
</head>
<body>
<div class="card">
    <div class="header">
        <span class="method">{method}</span>
        <span class="url">{url}</span>
        <span class="badge {status_class}">{status}</span>
        <span class="meta">{duration_str}</span>
    </div>
    <div class="meta" style="padding: 6px 20px; border-bottom: 1px solid #30363d;">{ts}</div>
    <div class="section">
        <div class="section-title">Request Headers</div>
        <div class="section-body"><pre>{_format_headers(flow_data.get("request_headers"))}</pre></div>
    </div>
    <div class="section">
        <div class="section-title">Request Body</div>
        <div class="section-body"><pre>{_format_body(flow_data.get("request_body"), flow_data.get("request_content_type"))}</pre></div>
    </div>
    <div class="section">
        <div class="section-title">Response Headers</div>
        <div class="section-body"><pre>{_format_headers(flow_data.get("response_headers"))}</pre></div>
    </div>
    <div class="section">
        <div class="section-title">Response Body</div>
        <div class="section-body"><pre>{_format_body(flow_data.get("response_body"), flow_data.get("response_content_type"))}</pre></div>
    </div>{notes_section}
    <div class="footer">Captured by Siphon</div>
</div>
</body>
</html>"""


def render_evidence_png(html: str, output_path: str | Path | None = None) -> bytes:
    from playwright.sync_api import sync_playwright

    if output_path is None:
        output_path = Path(tempfile.mktemp(suffix=".png"))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 960, "height": 800})
        page.set_content(html, wait_until="networkidle")
        card = page.query_selector(".card")
        if card:
            card.screenshot(path=str(output_path))
        else:
            page.screenshot(path=str(output_path), full_page=True)
        browser.close()

    data = Path(output_path).read_bytes()
    Path(output_path).unlink(missing_ok=True)
    return data
