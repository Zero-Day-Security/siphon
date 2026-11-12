from __future__ import annotations

import asyncio
import functools
import json
import secrets
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx
import starlette.requests
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from siphon.beacon.server import BeaconStore
from siphon.browser.manager import BrowserManager
from siphon.evidence.capture import capture_evidence, render_evidence_html, render_evidence_png
from siphon.export.burp_xml import burp_xml_to_flows, flows_to_burp_xml
from siphon.export.har import flows_to_har_json
from siphon.export.json_export import flows_to_json
from siphon.export.markdown import evidence_to_markdown, flows_to_markdown
from siphon.export.pdf import render_report_pdf
from siphon.export.project import load_project, save_project
from siphon.logging import TrafficLogger
from siphon.proxy.core import FlowStore


class NotesBody(BaseModel):
    notes: str


class SendRequestBody(BaseModel):
    method: str
    url: str
    headers: dict[str, str] = {}
    body: str | None = None


class EvidenceBody(BaseModel):
    notes: str = ""


class ScopeBody(BaseModel):
    patterns: list[str]


class BeaconTokenBody(BaseModel):
    description: str = ""


ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


def _make_allowed_origins(host: str, port: int) -> list[str]:
    origins = []
    for h in ALLOWED_HOSTS:
        origins.append(f"http://{h}:{port}")
        origins.append(f"https://{h}:{port}")
    if host not in ALLOWED_HOSTS:
        origins.append(f"http://{host}:{port}")
    return origins


class _AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any, api_token: str, api_port: int) -> None:
        super().__init__(app)
        self.api_token = api_token
        self.allowed_hosts = {f"{h}:{api_port}" for h in ALLOWED_HOSTS}
        self.allowed_hosts.add(f"localhost:{api_port}")
        self.allowed_hosts.add(f"127.0.0.1:{api_port}")

    async def dispatch(self, request: StarletteRequest, call_next: Any) -> Any:
        path = request.url.path

        if request.method == "OPTIONS":
            return await call_next(request)

        host_header = request.headers.get("host", "")
        if host_header.startswith("["):
            host_base = host_header.split("]")[0] + "]"
        else:
            host_base = host_header.split(":")[0] if host_header else ""
        if host_base and host_base not in ALLOWED_HOSTS:
            return JSONResponse(
                {"error": "Forbidden: invalid Host header"},
                status_code=403,
            )

        if path.startswith("/api/") and self.api_token:
            token = (
                request.headers.get("authorization", "").removeprefix("Bearer ").strip()
                or request.query_params.get("token", "")
            )
            if not secrets.compare_digest(token, self.api_token):
                return JSONResponse(
                    {"error": "Unauthorized: invalid or missing API token"},
                    status_code=401,
                )

        return await call_next(request)


def create_app(
    flow_store: FlowStore,
    logger: TrafficLogger | None = None,
    beacon_store: BeaconStore | None = None,
    browser_manager: BrowserManager | None = None,
    api_token: str = "",
    api_port: int = 9090,
) -> FastAPI:
    app = FastAPI(title="Siphon", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_make_allowed_origins("127.0.0.1", api_port),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_middleware(_AuthMiddleware, api_token=api_token, api_port=api_port)

    @app.get("/api/flows")
    def list_flows(
        host: str | None = None,
        method: str | None = None,
        status_code: int | None = None,
        search: str | None = None,
        limit: int = Query(default=500, le=5000),
        offset: int = Query(default=0, ge=0),
    ) -> dict[str, Any]:
        return flow_store.get_flows(
            host=host,
            method=method,
            status_code=status_code,
            search=search,
            limit=limit,
            offset=offset,
        )

    @app.get("/api/flows/{flow_id}")
    def get_flow(flow_id: str) -> JSONResponse:
        flow = flow_store.get_flow(flow_id)
        if not flow:
            return JSONResponse({"error": "Flow not found"}, status_code=404)
        return JSONResponse(flow)

    @app.delete("/api/flows")
    def clear_flows() -> dict[str, str]:
        flow_store.clear()
        return {"status": "cleared"}

    @app.post("/api/flows/{flow_id}/highlight")
    def toggle_highlight(flow_id: str) -> JSONResponse:
        result = flow_store.toggle_highlight(flow_id)
        if result is None:
            return JSONResponse({"error": "Flow not found"}, status_code=404)
        flow = flow_store.get_flow(flow_id)
        return JSONResponse(flow)

    @app.put("/api/flows/{flow_id}/notes")
    def set_notes(flow_id: str, body: NotesBody) -> JSONResponse:
        if not flow_store.set_notes(flow_id, body.notes):
            return JSONResponse({"error": "Flow not found"}, status_code=404)
        flow = flow_store.get_flow(flow_id)
        return JSONResponse(flow)

    @app.post("/api/flows/{flow_id}/replay")
    async def replay_request(flow_id: str) -> JSONResponse:
        flow = flow_store.get_flow(flow_id)
        if not flow:
            return JSONResponse({"error": "Flow not found"}, status_code=404)
        new_flow = await _send_http_request(
            flow_store,
            method=flow["method"],
            url=flow["url"],
            headers=flow.get("request_headers", {}),
            body=flow.get("request_body"),
            source="replay",
        )
        return JSONResponse(new_flow)

    @app.post("/api/send")
    async def send_request(body: SendRequestBody) -> JSONResponse:
        new_flow = await _send_http_request(
            flow_store,
            method=body.method,
            url=body.url,
            headers=body.headers,
            body=body.body,
            source="repeater",
        )
        return JSONResponse(new_flow)

    @app.post("/api/flows/{flow_id}/evidence")
    def create_evidence(flow_id: str, body: EvidenceBody) -> JSONResponse:
        flow = flow_store.get_flow(flow_id)
        if not flow:
            return JSONResponse({"error": "Flow not found"}, status_code=404)
        evidence = capture_evidence(flow, notes=body.notes)
        flow_store.add_evidence(evidence)
        flow_store.update_flow(flow_id, {"evidence_captured": True})
        return JSONResponse(evidence)

    @app.get("/api/evidence")
    def list_evidence() -> list[dict[str, Any]]:
        return flow_store.list_evidence()

    @app.get("/api/evidence/{evidence_id}")
    def get_evidence(evidence_id: str) -> JSONResponse:
        ev = flow_store.get_evidence(evidence_id)
        if not ev:
            return JSONResponse({"error": "Evidence not found"}, status_code=404)
        return JSONResponse(ev)

    @app.get("/api/evidence/{evidence_id}/html")
    def get_evidence_html(evidence_id: str) -> HTMLResponse:
        ev = flow_store.get_evidence(evidence_id)
        if not ev:
            return HTMLResponse("<h1>Not found</h1>", status_code=404)
        flow = flow_store.get_flow(ev["flow_id"])
        if not flow:
            return HTMLResponse("<h1>Flow data missing</h1>", status_code=404)
        html = render_evidence_html(ev, flow)
        return HTMLResponse(html)

    @app.get("/api/evidence/{evidence_id}/png")
    def get_evidence_png(evidence_id: str) -> Response:
        ev = flow_store.get_evidence(evidence_id)
        if not ev:
            return JSONResponse({"error": "Not found"}, status_code=404)
        flow = flow_store.get_flow(ev["flow_id"])
        if not flow:
            return JSONResponse({"error": "Flow data missing"}, status_code=404)
        html = render_evidence_html(ev, flow)
        png_bytes = render_evidence_png(html)
        return Response(content=png_bytes, media_type="image/png")

    def _ws_check(ws: WebSocket) -> str | None:
        origin = ws.headers.get("origin", "")
        if origin:
            from urllib.parse import urlparse
            parsed = urlparse(origin)
            hostname = parsed.hostname or ""
            if hostname not in ALLOWED_HOSTS and f"[{hostname}]" not in ALLOWED_HOSTS:
                return "Forbidden: invalid Origin"
        if api_token:
            tok = ws.query_params.get("token", "")
            if not tok or not secrets.compare_digest(tok, api_token):
                return "Unauthorized"
        return None

    @app.websocket("/api/ws")
    async def websocket_endpoint(ws: WebSocket) -> None:
        err = _ws_check(ws)
        if err:
            await ws.close(code=4001, reason=err)
            return
        await ws.accept()
        queue = flow_store.subscribe()
        try:
            while True:
                event = await queue.get()
                await ws.send_text(json.dumps(event, default=str))
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            flow_store.unsubscribe(queue)

    @app.get("/api/sessions")
    def list_sessions() -> list[dict[str, Any]]:
        if not logger:
            return []
        return logger.list_sessions()

    @app.post("/api/sessions/load")
    def load_session(body: dict[str, str]) -> dict[str, Any]:
        if not logger:
            return JSONResponse({"error": "Logging disabled"}, status_code=400)
        path = body.get("path", "")
        if not path:
            return JSONResponse({"error": "path required"}, status_code=400)
        resolved = Path(path).resolve()
        if not resolved.is_relative_to(logger.log_dir.resolve()):
            return JSONResponse({"error": "path must be within log directory"}, status_code=403)
        flows = logger.load_session(path)
        for f in flows:
            flow_store.add_flow(f)
        return {"loaded": len(flows)}

    @app.get("/api/log/status")
    def log_status() -> dict[str, Any]:
        if not logger:
            return {"enabled": False}
        return {
            "enabled": True,
            "path": str(logger.log_path),
            "flow_count": logger.flow_count,
        }

    # --- Beacon endpoints ---

    @app.post("/api/beacon/tokens")
    def create_beacon_token(body: BeaconTokenBody) -> JSONResponse:
        if not beacon_store:
            return JSONResponse({"error": "Beacon disabled"}, status_code=400)
        token = beacon_store.generate_token(description=body.description)
        return JSONResponse(token)

    @app.get("/api/beacon/tokens")
    def list_beacon_tokens() -> list[dict[str, Any]]:
        if not beacon_store:
            return []
        return beacon_store.list_tokens()

    @app.get("/api/beacon/tokens/{token}")
    def get_beacon_token(token: str) -> JSONResponse:
        if not beacon_store:
            return JSONResponse({"error": "Beacon disabled"}, status_code=400)
        tok = beacon_store.get_token(token)
        if not tok:
            return JSONResponse({"error": "Token not found"}, status_code=404)
        tok["interactions"] = beacon_store.get_interactions(token)
        return JSONResponse(tok)

    @app.delete("/api/beacon/tokens/{token}")
    def delete_beacon_token(token: str) -> JSONResponse:
        if not beacon_store:
            return JSONResponse({"error": "Beacon disabled"}, status_code=400)
        if not beacon_store.delete_token(token):
            return JSONResponse({"error": "Token not found"}, status_code=404)
        return JSONResponse({"status": "deleted"})

    @app.get("/api/beacon/interactions")
    def list_beacon_interactions() -> list[dict[str, Any]]:
        if not beacon_store:
            return []
        return beacon_store.get_all_interactions()

    @app.get("/api/beacon/interactions/{interaction_id}")
    def get_beacon_interaction(interaction_id: str) -> JSONResponse:
        if not beacon_store:
            return JSONResponse({"error": "Beacon disabled"}, status_code=400)
        interaction = beacon_store.get_interaction(interaction_id)
        if not interaction:
            return JSONResponse({"error": "Interaction not found"}, status_code=404)
        return JSONResponse(interaction)

    @app.websocket("/api/beacon/ws")
    async def beacon_ws(ws: WebSocket) -> None:
        if not beacon_store:
            await ws.close()
            return
        err = _ws_check(ws)
        if err:
            await ws.close(code=4001, reason=err)
            return
        await ws.accept()
        queue = beacon_store.subscribe()
        try:
            while True:
                event = await queue.get()
                await ws.send_text(json.dumps(event, default=str))
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            beacon_store.unsubscribe(queue)

    @app.get("/api/beacon/status")
    def beacon_status() -> dict[str, Any]:
        if not beacon_store:
            return {"enabled": False}
        tokens = beacon_store.list_tokens()
        interactions = beacon_store.get_all_interactions()
        return {
            "enabled": True,
            "url": beacon_store.base_url,
            "token_count": len(tokens),
            "interaction_count": len(interactions),
        }

    # --- Scope / Target endpoints ---

    @app.get("/api/scope")
    def get_scope() -> dict[str, Any]:
        return flow_store.get_scope()

    @app.put("/api/scope")
    def set_scope(body: ScopeBody) -> dict[str, Any]:
        flow_store.set_scope(body.patterns)
        return flow_store.get_scope()

    @app.post("/api/scope/toggle")
    def toggle_scope() -> dict[str, Any]:
        current = flow_store.get_scope()
        flow_store.set_scope_enabled(not current["enabled"])
        return flow_store.get_scope()

    @app.get("/api/sitemap")
    def get_sitemap() -> list[dict[str, Any]]:
        return flow_store.get_sitemap()

    # --- Export endpoints ---

    @app.get("/api/export/har")
    def export_har(
        host: str | None = None,
        method: str | None = None,
        search: str | None = None,
    ) -> Response:
        data = flow_store.get_flows(host=host, method=method, search=search, limit=5000)
        flows = data["flows"] if isinstance(data, dict) else data
        har_json = flows_to_har_json(flows)
        return Response(
            content=har_json,
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=siphon_export.har"},
        )

    @app.get("/api/export/burp-xml")
    def export_burp_xml(
        host: str | None = None,
        method: str | None = None,
        search: str | None = None,
    ) -> Response:
        data = flow_store.get_flows(host=host, method=method, search=search, limit=5000)
        flows = data["flows"] if isinstance(data, dict) else data
        xml_str = flows_to_burp_xml(flows)
        return Response(
            content=xml_str,
            media_type="application/xml",
            headers={"Content-Disposition": "attachment; filename=siphon_export.xml"},
        )

    @app.get("/api/export/json")
    def export_json(
        host: str | None = None,
        method: str | None = None,
        search: str | None = None,
    ) -> Response:
        data = flow_store.get_flows(host=host, method=method, search=search, limit=5000)
        flows = data["flows"] if isinstance(data, dict) else data
        json_str = flows_to_json(flows)
        return Response(
            content=json_str,
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=siphon_export.json"},
        )

    @app.get("/api/export/report/markdown")
    def export_report_markdown() -> Response:
        evidence_list = flow_store.list_evidence()
        flow_map = {}
        for ev in evidence_list:
            fid = ev.get("flow_id", "")
            if fid:
                flow = flow_store.get_flow(fid)
                if flow:
                    flow_map[fid] = flow
        md = evidence_to_markdown(evidence_list, flow_map)
        return Response(
            content=md,
            media_type="text/markdown",
            headers={"Content-Disposition": "attachment; filename=siphon_report.md"},
        )

    @app.get("/api/export/report/pdf")
    def export_report_pdf() -> Response:
        evidence_list = flow_store.list_evidence()
        flow_map = {}
        for ev in evidence_list:
            fid = ev.get("flow_id", "")
            if fid:
                flow = flow_store.get_flow(fid)
                if flow:
                    flow_map[fid] = flow
        pdf_bytes = render_report_pdf(evidence_list, flow_map)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=siphon_report.pdf"},
        )

    @app.post("/api/import/burp-xml")
    async def import_burp_xml(request: starlette.requests.Request) -> JSONResponse:
        body = await request.body()
        xml_str = body.decode("utf-8", errors="replace")
        flows = burp_xml_to_flows(xml_str)
        for f in flows:
            flow_store.add_flow(f)
        return JSONResponse({"imported": len(flows)})

    # --- Project save/load endpoints ---

    @app.get("/api/project/save")
    def project_save() -> Response:
        project_json = save_project(flow_store, beacon_store)
        return Response(
            content=project_json,
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=project.siphon"},
        )

    @app.post("/api/project/load")
    async def project_load(request: starlette.requests.Request) -> JSONResponse:
        body = await request.body()
        project_json = body.decode("utf-8", errors="replace")
        stats = load_project(project_json, flow_store, beacon_store, merge=False)
        return JSONResponse(stats)

    @app.post("/api/project/merge")
    async def project_merge(request: starlette.requests.Request) -> JSONResponse:
        body = await request.body()
        project_json = body.decode("utf-8", errors="replace")
        stats = load_project(project_json, flow_store, beacon_store, merge=True)
        return JSONResponse(stats)

    # --- Browser endpoints ---
    # Single-thread executor ensures all Playwright calls run on the same thread
    _browser_pool = ThreadPoolExecutor(max_workers=1)

    async def _brun(fn: Any, *args: Any, **kwargs: Any) -> Any:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _browser_pool, functools.partial(fn, *args, **kwargs)
        )

    @app.post("/api/browser/start")
    async def browser_start(body: dict[str, Any] | None = None) -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"error": "Browser not available"}, status_code=400)
        opts = body or {}
        result = await _brun(
            browser_manager.start,
            headless=opts.get("headless", True),
            xss_hooks=opts.get("xss_hooks", False),
        )
        return JSONResponse(result)

    @app.post("/api/browser/stop")
    async def browser_stop() -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"error": "Browser not available"}, status_code=400)
        result = await _brun(browser_manager.stop)
        return JSONResponse(result)

    @app.get("/api/browser/status")
    async def browser_status() -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"running": False, "available": False})
        info = await _brun(browser_manager.get_status)
        return JSONResponse(info)

    @app.post("/api/browser/navigate")
    async def browser_navigate(body: dict[str, Any]) -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"error": "Browser not available"}, status_code=400)
        url = body.get("url", "")
        if not url:
            return JSONResponse({"error": "url required"}, status_code=400)
        result = await _brun(browser_manager.navigate, url)
        return JSONResponse(result)

    @app.post("/api/browser/click")
    async def browser_click(body: dict[str, Any]) -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"error": "Browser not available"}, status_code=400)
        result = await _brun(
            browser_manager.click,
            selector=body.get("selector"),
            x=body.get("x"),
            y=body.get("y"),
        )
        return JSONResponse(result)

    @app.post("/api/browser/type")
    async def browser_type(body: dict[str, Any]) -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"error": "Browser not available"}, status_code=400)
        selector = body.get("selector", "")
        text = body.get("text", "")
        press_enter = body.get("press_enter", False)
        if not selector or not text:
            return JSONResponse({"error": "selector and text required"}, status_code=400)
        result = await _brun(browser_manager.type_text, selector, text, press_enter)
        return JSONResponse(result)

    @app.get("/api/browser/screenshot")
    async def browser_screenshot() -> Response:
        if not browser_manager or not browser_manager.is_running:
            return JSONResponse({"error": "Browser not running"}, status_code=400)
        png = await _brun(browser_manager.screenshot)
        if not png:
            return JSONResponse({"error": "Screenshot failed"}, status_code=500)
        return Response(content=png, media_type="image/png")

    @app.post("/api/browser/evaluate")
    async def browser_evaluate(body: dict[str, Any]) -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"error": "Browser not available"}, status_code=400)
        expr = body.get("expression", "")
        if not expr:
            return JSONResponse({"error": "expression required"}, status_code=400)
        result = await _brun(browser_manager.evaluate, expr)
        safe = json.loads(json.dumps(result, default=str))
        return JSONResponse(safe)

    @app.post("/api/browser/back")
    async def browser_back() -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"error": "Browser not available"}, status_code=400)
        result = await _brun(browser_manager.back)
        return JSONResponse(result)

    @app.post("/api/browser/forward")
    async def browser_forward() -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"error": "Browser not available"}, status_code=400)
        result = await _brun(browser_manager.forward)
        return JSONResponse(result)

    @app.post("/api/browser/reload")
    async def browser_reload() -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"error": "Browser not available"}, status_code=400)
        result = await _brun(browser_manager.reload)
        return JSONResponse(result)

    @app.get("/api/browser/xss")
    async def browser_xss_events() -> JSONResponse:
        if not browser_manager:
            return JSONResponse([])
        result = await _brun(browser_manager.get_xss_events)
        return JSONResponse(result)

    @app.delete("/api/browser/xss")
    async def clear_xss_events() -> JSONResponse:
        if browser_manager:
            await _brun(browser_manager.clear_xss_events)
        return JSONResponse({"status": "cleared"})

    @app.get("/api/browser/info")
    async def browser_info() -> JSONResponse:
        if not browser_manager:
            return JSONResponse({"error": "Browser not available"}, status_code=400)
        result = await _brun(browser_manager.get_page_info)
        return JSONResponse(result)

    ui_dist = Path(__file__).resolve().parent.parent.parent / "ui" / "dist"
    if ui_dist.is_dir():
        index_html = ui_dist / "index.html"
        if index_html.is_file() and api_token:
            _raw_html = index_html.read_text()
            _token_script = f'<script>localStorage.setItem("siphon_api_token","{api_token}")</script>'
            _injected_html = _raw_html.replace("</head>", f"{_token_script}</head>", 1)

            @app.get("/", response_class=HTMLResponse)
            def serve_index() -> HTMLResponse:
                return HTMLResponse(_injected_html)

        app.mount("/", StaticFiles(directory=str(ui_dist), html=True), name="ui")

    return app


async def _send_http_request(
    store: FlowStore,
    method: str,
    url: str,
    headers: dict[str, str],
    body: str | None,
    source: str = "manual",
) -> dict[str, Any]:
    flow_id = str(uuid.uuid4())
    start = time.time()

    flow_data: dict[str, Any] = {
        "id": flow_id,
        "timestamp": start,
        "method": method.upper(),
        "url": url,
        "host": "",
        "port": 0,
        "path": "",
        "scheme": "",
        "request_headers": headers,
        "request_body": body,
        "request_content_type": headers.get("content-type"),
        "status_code": None,
        "response_headers": None,
        "response_body": None,
        "response_content_type": None,
        "duration_ms": None,
        "highlighted": False,
        "notes": "",
        "tags": [],
        "evidence_captured": False,
        "source": source,
    }

    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        flow_data["host"] = parsed.hostname or ""
        flow_data["port"] = parsed.port or (443 if parsed.scheme == "https" else 80)
        flow_data["path"] = parsed.path or "/"
        flow_data["scheme"] = parsed.scheme or "https"
    except Exception:
        pass

    store.add_flow(flow_data)

    try:
        async with httpx.AsyncClient(verify=False, timeout=30.0) as client:
            resp = await client.request(
                method=method,
                url=url,
                headers=headers,
                content=body.encode() if body else None,
            )
        duration_ms = round((time.time() - start) * 1000, 1)
        content_type = resp.headers.get("content-type", "")

        resp_body: str | None
        is_text = any(t in content_type for t in ("text/", "json", "xml", "javascript", "html"))
        if is_text:
            resp_body = resp.text
        else:
            import base64
            resp_body = base64.b64encode(resp.content).decode("ascii") if resp.content else ""

        updates = {
            "status_code": resp.status_code,
            "response_headers": dict(resp.headers),
            "response_body": resp_body,
            "response_content_type": content_type or None,
            "duration_ms": duration_ms,
        }
        store.update_flow(flow_id, updates)
        flow_data.update(updates)
    except Exception as exc:
        store.update_flow(flow_id, {"notes": f"Error: {exc}"})
        flow_data["notes"] = f"Error: {exc}"

    return flow_data
