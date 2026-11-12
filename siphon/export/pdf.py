from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from siphon.export.markdown import evidence_to_markdown


def render_report_pdf(
    evidence_list: list[dict[str, Any]],
    flows: dict[str, dict[str, Any]],
    title: str = "Siphon Security Assessment Report",
) -> bytes:
    md = evidence_to_markdown(evidence_list, flows, title=title)
    html = _markdown_to_html(md, title)
    return _html_to_pdf(html)


def _markdown_to_html(md: str, title: str) -> str:
    from html import escape

    lines = md.split("\n")
    html_parts: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## "):
            html_parts.append(f"<h2>{_inline(stripped[3:])}</h2>")
        elif stripped.startswith("# "):
            html_parts.append(f"<h1>{_inline(stripped[2:])}</h1>")
        elif stripped.startswith("### "):
            html_parts.append(f"<h3>{_inline(stripped[4:])}</h3>")
        elif stripped == "```" or stripped.startswith("```"):
            in_code = False
            for p in reversed(html_parts):
                if "</code></pre>" in p:
                    break
                if "<pre><code>" in p:
                    in_code = True
                    break
            if in_code:
                html_parts.append("</code></pre>")
            else:
                html_parts.append("<pre><code>")
        elif stripped.startswith("**") and stripped.endswith("  "):
            html_parts.append(f"<p>{_inline(stripped)}</p>")
        elif stripped.startswith("| ") and "---" not in stripped:
            cells = [c.strip() for c in stripped.split("|")[1:-1]]
            if not html_parts or "<table>" not in "".join(html_parts[-5:]):
                html_parts.append("<table><thead><tr>")
                for c in cells:
                    html_parts.append(f"<th>{_inline(c)}</th>")
                html_parts.append("</tr></thead><tbody>")
            else:
                html_parts.append("<tr>")
                for c in cells:
                    html_parts.append(f"<td>{_inline(c)}</td>")
                html_parts.append("</tr>")
        elif stripped.startswith("|") and "---" in stripped:
            pass
        elif stripped == "---":
            html_parts.append("<hr>")
        elif stripped.startswith("*") and stripped.endswith("*"):
            html_parts.append(f"<p><em>{escape(stripped.strip('*'))}</em></p>")
        elif stripped:
            in_pre = False
            for p in reversed(html_parts):
                if "</code></pre>" in p:
                    break
                if "<pre><code>" in p:
                    in_pre = True
                    break
            if in_pre:
                html_parts.append(escape(line))
            else:
                html_parts.append(f"<p>{_inline(stripped)}</p>")

    body = "\n".join(html_parts)
    for tag in ["</tbody>", "</table>"]:
        if body.count("<table>") > body.count("</table>"):
            body += tag

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{escape(title)}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 12px; color: #c9d1d9; background: #0d1117; padding: 32px; }}
h1 {{ font-size: 22px; margin-bottom: 8px; color: #e6edf3; }}
h2 {{ font-size: 16px; margin: 24px 0 8px; color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 4px; }}
h3 {{ font-size: 13px; margin: 12px 0 4px; color: #8b949e; }}
p {{ margin: 4px 0; line-height: 1.5; }}
pre {{ background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px; font-size: 11px; font-family: 'SF Mono', monospace; overflow-wrap: break-word; white-space: pre-wrap; margin: 4px 0 12px; }}
code {{ font-family: 'SF Mono', monospace; background: #161b22; padding: 1px 4px; border-radius: 3px; font-size: 11px; }}
hr {{ border: none; border-top: 1px solid #30363d; margin: 16px 0; }}
table {{ width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 11px; }}
th, td {{ padding: 6px 8px; border: 1px solid #30363d; text-align: left; }}
th {{ background: #161b22; color: #8b949e; font-weight: 600; }}
strong {{ color: #e6edf3; }}
</style></head><body>{body}</body></html>"""


def _inline(text: str) -> str:
    from html import escape
    text = escape(text)
    import re
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'`(.+?)`', r'<code>\1</code>', text)
    text = re.sub(r'\[(.+?)\]\((.+?)\)', r'<a href="\2">\1</a>', text)
    return text


def _html_to_pdf(html: str) -> bytes:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(html, wait_until="networkidle")
        pdf_bytes = page.pdf(
            format="A4",
            print_background=True,
            margin={"top": "20mm", "bottom": "20mm", "left": "15mm", "right": "15mm"},
        )
        browser.close()
    return pdf_bytes
