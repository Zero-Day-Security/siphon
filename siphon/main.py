from __future__ import annotations

import argparse
import asyncio
import secrets
import sys
import threading

import uvicorn

from siphon.api.server import create_app
from siphon.beacon.server import BeaconStore, start_beacon_server
from siphon.browser.manager import BrowserManager
from siphon.logging import TrafficLogger
from siphon.proxy.addon import SiphonAddon
from siphon.proxy.core import FlowStore

BANNER = r"""
   _____ _       __
  / ___/(_)___  / /_  ____  ____
  \__ \/ / __ \/ __ \/ __ \/ __ \
 ___/ / / /_/ / / / / /_/ / / / /
/____/_/ .___/_/ /_/\____/_/ /_/
      /_/
"""


def _start_api_server(
    flow_store: FlowStore,
    host: str,
    port: int,
    quiet: bool = True,
    logger: TrafficLogger | None = None,
    beacon_store: BeaconStore | None = None,
    browser_manager: BrowserManager | None = None,
    api_token: str = "",
) -> threading.Thread:
    app = create_app(
        flow_store, logger=logger, beacon_store=beacon_store,
        browser_manager=browser_manager, api_token=api_token, api_port=port,
    )
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="warning" if quiet else "info",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    return thread


def main() -> None:
    parser = argparse.ArgumentParser(description="Siphon — AI-native HTTP proxy")
    parser.add_argument("--proxy-port", type=int, default=8080)
    parser.add_argument("--api-port", type=int, default=9090)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--log-dir", default="./siphon_logs", help="Directory for traffic log files")
    parser.add_argument("--no-log", action="store_true", help="Disable traffic logging")
    parser.add_argument("--beacon-port", type=int, default=7070, help="Beacon callback listener port")
    parser.add_argument("--no-beacon", action="store_true", help="Disable Beacon (out-of-band interaction server)")
    parser.add_argument("--beacon-url", default=None, help="Public Beacon URL for payloads (e.g. https://your-vps:7070)")
    parser.add_argument("--beacon-host", default=None, help="Beacon listen address (default: same as --host, use 0.0.0.0 for external)")
    parser.add_argument("--beacon-ngrok", action="store_true", help="Auto-start ngrok tunnel for Beacon (public URL, no setup)")
    parser.add_argument("--api-token", default=None, help="API auth token (default: auto-generated)")
    parser.add_argument("--no-auth", action="store_true", help="Disable API authentication (NOT recommended)")
    parser.add_argument("--no-sandbox", action="store_true", help="Disable Chrome sandbox in built-in browser (only for Docker/root)")
    args = parser.parse_args()

    if args.no_auth:
        api_token = ""
    else:
        api_token = args.api_token or secrets.token_urlsafe(32)

    flow_store = FlowStore()

    logger = None
    if not args.no_log:
        logger = TrafficLogger(args.log_dir)

    beacon_store = None
    ngrok_tunnel = None
    if not args.no_beacon:
        beacon_listen = args.beacon_host or args.host
        beacon_base_url = args.beacon_url or f"http://{args.host}:{args.beacon_port}"

        if args.beacon_ngrok and not args.beacon_url:
            try:
                from pyngrok import ngrok
                ngrok_tunnel = ngrok.connect(args.beacon_port, "http")
                beacon_base_url = ngrok_tunnel.public_url
                beacon_listen = "0.0.0.0"
            except ImportError:
                print("  WARNING:  pyngrok not installed. Install with: pip install pyngrok")
                print("     Falling back to local beacon URL.")
            except Exception as exc:
                print(f"  WARNING:  ngrok tunnel failed: {exc}")
                print("     Falling back to local beacon URL.")

        beacon_store = BeaconStore(base_url=beacon_base_url)
        start_beacon_server(beacon_store, beacon_listen, args.beacon_port)

    browser_mgr = BrowserManager(proxy_host=args.host, proxy_port=args.proxy_port, no_sandbox=args.no_sandbox)

    _start_api_server(
        flow_store, args.host, args.api_port,
        quiet=not args.verbose, logger=logger, beacon_store=beacon_store,
        browser_manager=browser_mgr, api_token=api_token,
    )

    print(BANNER)
    print(f"  Proxy   ->  {args.host}:{args.proxy_port}")
    print(f"  Web UI  ->  http://{args.host}:{args.api_port}")
    print(f"  API     ->  http://{args.host}:{args.api_port}/api")
    if beacon_store:
        print(f"  Beacon  ->  {beacon_base_url}")
        if args.beacon_url:
            print(f"  Beacon listen ->  {args.host}:{args.beacon_port}")
    if logger:
        print(f"  Logging ->  {logger.log_path}")
    if api_token:
        print(f"  API Token ->  {api_token}")
        print()
        print(f"  MCP config:")
        print(f'    SIPHON_API_URL=http://{args.host}:{args.api_port}')
        print(f'    SIPHON_API_TOKEN={api_token}')
    else:
        print()
        print("  WARNING:  API auth disabled (--no-auth). Not recommended for production.")
    print()
    print("  Configure your browser/tool to use the proxy above.")
    print("  Press Ctrl+C to stop.\n")

    from mitmproxy.options import Options
    from mitmproxy.tools.dump import DumpMaster

    async def run_proxy() -> None:
        opts = Options(listen_host=args.host, listen_port=args.proxy_port)
        master = DumpMaster(opts, with_termlog=args.verbose, with_dumper=args.verbose)
        master.addons.add(SiphonAddon(flow_store, logger=logger))
        await master.run()

    try:
        asyncio.run(run_proxy())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
