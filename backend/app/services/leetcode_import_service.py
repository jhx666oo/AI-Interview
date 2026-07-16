import json
import re
import urllib.request
import urllib.parse
from html import unescape
from html.parser import HTMLParser
from typing import Dict, Any, Optional, List, Tuple

from fastapi import HTTPException


class _HtmlToText(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._in_pre = 0
        self._in_code = 0
        self._li_depth = 0

    def handle_starttag(self, tag: str, attrs):
        tag = tag.lower()
        if tag == "pre":
            self._in_pre += 1
            self._parts.append("\n```")
        elif tag == "code":
            self._in_code += 1
        elif tag in ["p", "br"]:
            self._parts.append("\n")
        elif tag == "li":
            self._li_depth += 1
            self._parts.append("\n- ")
        elif tag in ["ul", "ol"]:
            self._parts.append("\n")
        elif tag in ["h1", "h2", "h3", "h4"]:
            self._parts.append("\n\n")

    def handle_endtag(self, tag: str):
        tag = tag.lower()
        if tag == "pre":
            if self._in_pre > 0:
                self._in_pre -= 1
            self._parts.append("\n```\n")
        elif tag == "code":
            if self._in_code > 0:
                self._in_code -= 1
        elif tag == "li":
            if self._li_depth > 0:
                self._li_depth -= 1
        elif tag in ["p", "ul", "ol"]:
            self._parts.append("\n")

    def handle_data(self, data: str):
        if not data:
            return
        text = unescape(data)
        if self._in_pre > 0:
            self._parts.append(text)
            return
        text = re.sub(r"[ \t\r\f\v]+", " ", text)
        self._parts.append(text)

    def get_text(self) -> str:
        out = "".join(self._parts)
        out = re.sub(r"\n{3,}", "\n\n", out)
        return out.strip()


def _extract_title_slug(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL")

    host = (parsed.hostname or "").lower()
    if host not in ["leetcode.com", "www.leetcode.com", "leetcode.cn", "www.leetcode.cn"]:
        raise HTTPException(status_code=400, detail="Only leetcode.com / leetcode.cn URLs are supported")

    m = re.search(r"/problems/([^/]+)/?", parsed.path)
    if not m:
        raise HTTPException(status_code=400, detail="Failed to parse problem slug from URL")

    slug = m.group(1).strip()
    if not slug:
        raise HTTPException(status_code=400, detail="Failed to parse problem slug from URL")
    return slug


def _leetcode_graphql_endpoint(url: str) -> str:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if host.endswith("leetcode.cn"):
        return "https://leetcode.cn/graphql/"
    return "https://leetcode.com/graphql/"


def _post_graphql(endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "ai-interview-assistant/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to fetch LeetCode problem content")


def _split_top_level(s: str, sep: str = ",") -> List[str]:
    parts: List[str] = []
    buf: List[str] = []
    depth = 0
    in_str = False
    esc = False
    for ch in s:
        if in_str:
            buf.append(ch)
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == "\"":
                in_str = False
            continue
        if ch == "\"":
            in_str = True
            buf.append(ch)
            continue
        if ch in ["[", "{", "("]:
            depth += 1
            buf.append(ch)
            continue
        if ch in ["]", "}", ")"]:
            depth = max(0, depth - 1)
            buf.append(ch)
            continue
        if ch == sep and depth == 0:
            part = "".join(buf).strip()
            if part:
                parts.append(part)
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def _parse_value(raw: str) -> Any:
    s = (raw or "").strip()
    if not s:
        return ""
    s = s.replace("None", "null")
    try:
        return json.loads(s)
    except Exception:
        pass
    try:
        if re.fullmatch(r"-?\d+", s):
            return int(s)
        if re.fullmatch(r"-?\d+\.\d+", s):
            return float(s)
    except Exception:
        pass
    m = re.fullmatch(r"\"(.*)\"", s)
    if m:
        return m.group(1)
    return s


def _parse_args_from_input(input_text: str, meta: Optional[Dict[str, Any]]) -> List[Any]:
    s = (input_text or "").strip()
    if not s:
        return []
    s = re.sub(r"^(?:Input|输入)\s*[:：]\s*", "", s, flags=re.IGNORECASE).strip()

    params = []
    try:
        params = (meta or {}).get("params") or []
    except Exception:
        params = []

    if "=" in s:
        assignments = _split_top_level(s, ",")
        kv: Dict[str, Any] = {}
        for part in assignments:
            if "=" not in part:
                continue
            k, v = part.split("=", 1)
            key = k.strip()
            val = v.strip()
            kv[key] = _parse_value(val)
        if params:
            out: List[Any] = []
            for p in params:
                name = (p or {}).get("name")
                if name in kv:
                    out.append(kv[name])
            if out:
                return out
        if kv:
            return list(kv.values())

    if params and "\n" in s:
        lines = [ln.strip() for ln in s.splitlines() if ln.strip()]
        if len(lines) == len(params):
            return [_parse_value(ln) for ln in lines]

    if "," in s and params and len(params) > 1:
        tokens = _split_top_level(s, ",")
        if len(tokens) == len(params):
            return [_parse_value(t) for t in tokens]

    return [_parse_value(s)]


def _extract_examples(description: str) -> List[Tuple[str, str]]:
    text = description or ""
    text = text.replace("：", ":")
    pairs: List[Tuple[str, str]] = []

    inline = re.compile(r"(?:Input|输入)\s*:\s*(.+?)\s*(?:Output|输出)\s*:\s*(.+?)(?:\n|$)", re.IGNORECASE)
    for m in inline.finditer(text):
        pairs.append((m.group(1).strip(), m.group(2).strip()))

    if pairs:
        return pairs

    lines = [ln.strip() for ln in text.splitlines()]
    cur_in: Optional[str] = None
    cur_out: Optional[str] = None
    for ln in lines:
        if not ln:
            continue
        if re.match(r"^(?:Example|示例)\b", ln, flags=re.IGNORECASE):
            if cur_in and cur_out:
                pairs.append((cur_in.strip(), cur_out.strip()))
            cur_in = None
            cur_out = None
            continue
        m_in = re.match(r"^(?:Input|输入)\s*:\s*(.*)$", ln, flags=re.IGNORECASE)
        if m_in:
            if cur_in and cur_out:
                pairs.append((cur_in.strip(), cur_out.strip()))
                cur_out = None
            cur_in = m_in.group(1).strip()
            continue
        m_out = re.match(r"^(?:Output|输出)\s*:\s*(.*)$", ln, flags=re.IGNORECASE)
        if m_out:
            cur_out = m_out.group(1).strip()
            continue
        if re.match(r"^(?:Explanation|解释)\s*:\s*", ln, flags=re.IGNORECASE):
            if cur_in and cur_out:
                pairs.append((cur_in.strip(), cur_out.strip()))
            cur_in = None
            cur_out = None
            continue
        if cur_out is not None:
            continue
        if cur_in is not None and len(cur_in) < 500:
            cur_in = (cur_in + " " + ln).strip()

    if cur_in and cur_out:
        pairs.append((cur_in.strip(), cur_out.strip()))
    return pairs


def _build_test_cases(description: str, meta: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    pairs = _extract_examples(description)
    out: List[Dict[str, Any]] = []
    for input_text, output_text in pairs[:5]:
        args = _parse_args_from_input(input_text, meta)
        expected = _parse_value(output_text)
        out.append({"input": args, "expected": expected})
    return out


def import_leetcode_problem(url: str) -> Dict[str, Any]:
    slug = _extract_title_slug(url)
    endpoint = _leetcode_graphql_endpoint(url)

    query = """
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        title
        titleSlug
        content
        translatedContent
        difficulty
        metaData
      }
    }
    """

    data = _post_graphql(endpoint, {"query": query, "variables": {"titleSlug": slug}})
    q = (data.get("data") or {}).get("question")
    if not q:
        raise HTTPException(status_code=404, detail="Problem not found")

    title = q.get("title") or slug
    difficulty_raw = (q.get("difficulty") or "").lower()
    difficulty_map = {"easy": "junior", "medium": "intermediate", "hard": "senior"}
    difficulty = difficulty_map.get(difficulty_raw, "intermediate")

    content_html = q.get("translatedContent") or q.get("content") or ""
    parser = _HtmlToText()
    parser.feed(content_html)
    description = parser.get_text()
    if not description:
        description = title

    meta: Optional[Dict[str, Any]] = None
    try:
        meta = json.loads(q.get("metaData") or "{}")
    except Exception:
        meta = None

    test_cases = _build_test_cases(description, meta)

    return {
        "title": title,
        "description": description,
        "difficulty": difficulty,
        "slug": slug,
        "test_cases": test_cases,
    }
