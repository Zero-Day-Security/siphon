from __future__ import annotations

import asyncio
import base64
import threading
import time
from typing import Any

from playwright.sync_api import sync_playwright, Browser, Page, BrowserContext

XSS_HOOK_SCRIPT = """
(() => {
    const _origAlert = window.alert;
    const _origConfirm = window.confirm;
    const _origPrompt = window.prompt;

    window.__siphon_xss_events = [];

    function report(type, args) {
        const evt = { type, args: String(args), url: location.href, timestamp: Date.now() };
        window.__siphon_xss_events.push(evt);
        console.warn('[Siphon XSS] ' + type + ': ' + String(args));
    }

    window.alert = function(msg) { report('alert', msg); };
    window.confirm = function(msg) { report('confirm', msg); return true; };
    window.prompt = function(msg, def) { report('prompt', msg); return def || ''; };
})();
"""


class BrowserManager:
    def __init__(self, proxy_host: str = "127.0.0.1", proxy_port: int = 8080, no_sandbox: bool = False) -> None:
        self.proxy_host = proxy_host
        self.proxy_port = proxy_port
        self._no_sandbox = no_sandbox
        self._pw: Any = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None
        self._lock = threading.Lock()
        self._running = False
        self._xss_events: list[dict[str, Any]] = []

    @property
    def is_running(self) -> bool:
        return self._running and self._page is not None

    def get_status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "running": self._running and self._page is not None,
                "available": True,
                "url": self._get_url() if self._running else None,
            }

    def start(
        self,
        viewport_width: int = 1280,
        viewport_height: int = 800,
        headless: bool = True,
        xss_hooks: bool = False,
    ) -> dict[str, Any]:
        with self._lock:
            if self._running:
                return {"status": "already_running", "url": self._get_url()}
            pw = sync_playwright().start()
            self._pw = pw
            launch_args = ["--disable-blink-features=AutomationControlled"]
            if self._no_sandbox:
                launch_args.append("--no-sandbox")
            self._browser = pw.chromium.launch(
                headless=headless,
                args=launch_args,
            )
            self._context = self._browser.new_context(
                viewport={"width": viewport_width, "height": viewport_height},
                proxy={"server": f"http://{self.proxy_host}:{self.proxy_port}"},
                ignore_https_errors=True,
            )
            self._xss_enabled = xss_hooks
            if xss_hooks:
                self._context.add_init_script(XSS_HOOK_SCRIPT)
            self._page = self._context.new_page()
            self._page.goto("https://zerodaysecurity.net")
            self._running = True
            self._headless = headless
            self._xss_events = []
            mode = "headless" if headless else "visible"
            url = self._get_url()
            return {"status": "started", "url": url, "mode": mode, "xss_hooks": xss_hooks}

    def stop(self) -> dict[str, Any]:
        with self._lock:
            if not self._running:
                return {"status": "not_running"}
            try:
                if self._context:
                    self._context.close()
                if self._browser:
                    self._browser.close()
                if self._pw:
                    self._pw.stop()
            except Exception:
                pass
            self._page = None
            self._context = None
            self._browser = None
            self._pw = None
            self._running = False
            return {"status": "stopped"}

    def navigate(self, url: str, wait_until: str = "domcontentloaded") -> dict[str, Any]:
        with self._lock:
            if not self._page:
                return {"error": "Browser not running"}
            try:
                self._page.goto(url, wait_until=wait_until, timeout=30000)
                self._collect_xss()
                return {"url": self._page.url, "title": self._page.title()}
            except Exception as e:
                return {"error": str(e), "url": url}

    def click(self, selector: str | None = None, x: int | None = None, y: int | None = None) -> dict[str, Any]:
        with self._lock:
            if not self._page:
                return {"error": "Browser not running"}
            try:
                if selector:
                    self._page.click(selector, timeout=5000)
                elif x is not None and y is not None:
                    self._page.mouse.click(x, y)
                else:
                    return {"error": "Provide selector or x,y coordinates"}
                self._page.wait_for_load_state("domcontentloaded", timeout=5000)
                self._collect_xss()
                return {"url": self._page.url, "title": self._page.title()}
            except Exception as e:
                return {"url": self._get_url(), "error": str(e)}

    def type_text(self, selector: str, text: str, press_enter: bool = False) -> dict[str, Any]:
        with self._lock:
            if not self._page:
                return {"error": "Browser not running"}
            try:
                self._page.fill(selector, text, timeout=5000)
                if press_enter:
                    self._page.press(selector, "Enter")
                    self._page.wait_for_load_state("domcontentloaded", timeout=5000)
                self._collect_xss()
                return {"url": self._page.url, "typed": text}
            except Exception as e:
                return {"error": str(e)}

    def screenshot(self) -> bytes:
        with self._lock:
            if not self._page:
                return b""
            try:
                return self._page.screenshot(type="png")
            except Exception:
                return b""

    def screenshot_base64(self) -> str:
        data = self.screenshot()
        return base64.b64encode(data).decode() if data else ""

    def evaluate(self, expression: str) -> dict[str, Any]:
        with self._lock:
            if not self._page:
                return {"error": "Browser not running"}
            try:
                result = self._page.evaluate(expression)
                self._collect_xss()
                return {"result": result}
            except Exception as e:
                return {"error": str(e)}

    def get_url(self) -> str:
        with self._lock:
            return self._get_url()

    def get_page_info(self) -> dict[str, Any]:
        with self._lock:
            if not self._page:
                return {"error": "Browser not running"}
            try:
                return {
                    "url": self._page.url,
                    "title": self._page.title(),
                }
            except Exception as e:
                return {"error": str(e)}

    def get_xss_events(self) -> list[dict[str, Any]]:
        with self._lock:
            self._collect_xss()
            return list(self._xss_events)

    def clear_xss_events(self) -> None:
        with self._lock:
            self._xss_events.clear()

    def back(self) -> dict[str, Any]:
        with self._lock:
            if not self._page:
                return {"error": "Browser not running"}
            try:
                self._page.go_back(timeout=10000)
                return {"url": self._page.url, "title": self._page.title()}
            except Exception as e:
                return {"error": str(e)}

    def forward(self) -> dict[str, Any]:
        with self._lock:
            if not self._page:
                return {"error": "Browser not running"}
            try:
                self._page.go_forward(timeout=10000)
                return {"url": self._page.url, "title": self._page.title()}
            except Exception as e:
                return {"error": str(e)}

    def reload(self) -> dict[str, Any]:
        with self._lock:
            if not self._page:
                return {"error": "Browser not running"}
            try:
                self._page.reload(timeout=10000)
                self._collect_xss()
                return {"url": self._page.url, "title": self._page.title()}
            except Exception as e:
                return {"error": str(e)}

    def _get_url(self) -> str:
        if self._page:
            try:
                return self._page.url
            except Exception:
                return ""
        return ""

    def _collect_xss(self) -> None:
        if not self._page:
            return
        try:
            events = self._page.evaluate("window.__siphon_xss_events || []")
            if events:
                self._xss_events.extend(events)
                self._page.evaluate("window.__siphon_xss_events = []")
        except Exception:
            pass
