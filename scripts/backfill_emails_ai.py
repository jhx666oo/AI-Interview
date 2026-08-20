#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI 提取简历邮箱回填脚本（一次性运维工具）

调用已部署系统的管理端点 POST /api/admin/ai-extract-emails，
由 Worker 端调用系统配置的 LLM（多槽位自动降级）从简历文本提取邮箱，
回填 resumes.email 并记录 email_ai_checked_at（确认无邮箱的简历不再重复调用）。

用法（在仓库根目录执行）：
    python scripts/backfill_emails_ai.py                # 自动循环直至处理完
    python scripts/backfill_emails_ai.py --limit 20     # 每批条数（默认 8，上限 20）
    python scripts/backfill_emails_ai.py --batch 5      # 最多跑 5 批后停止（0=不限）

前置：
    - 系统已部署（含 0045 迁移与 ai-extract-emails 端点）
    - 凭证：脚本同目录/仓库根目录存在 credentials.json（{base_url, api_key}），
      或通过 --base-url / --api-key 传入
    - 请求带浏览器 User-Agent（Cloudflare 会拦截默认 UA）
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def load_credentials(script_dir: str) -> dict:
    candidates = [
        os.path.join(script_dir, "credentials.json"),
        os.path.join(os.getcwd(), "credentials.json"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            if data.get("api_key") and data.get("base_url"):
                return data
    raise SystemExit(
        "未找到 credentials.json（需含 base_url 与 api_key）。"
        "可将本脚本放到含该文件的目录，或用 --base-url/--api-key 传入。"
    )


def call_extract(base_url: str, api_key: str, limit: int) -> dict:
    url = f"{base_url.rstrip('/')}/api/admin/ai-extract-emails?limit={limit}"
    req = urllib.request.Request(
        url,
        data=b"{}",
        headers={
            "User-Agent": BROWSER_UA,
            "x-api-key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {err.code}: {detail[:300]}") from None
    except urllib.error.URLError as err:
        raise SystemExit(f"请求失败: {err}") from None


def main() -> None:
    parser = argparse.ArgumentParser(description="AI 提取简历邮箱回填脚本")
    parser.add_argument("--limit", type=int, default=8, help="每批条数（默认 8，上限 20）")
    parser.add_argument("--batch", type=int, default=0, help="最多跑多少批（0=不限，默认跑完全部）")
    parser.add_argument("--interval", type=float, default=2.0, help="批间间隔秒数（默认 2）")
    parser.add_argument("--base-url", default=None, help="系统地址，缺省从 credentials.json 读取")
    parser.add_argument("--api-key", default=None, help="管理员 API Key，缺省从 credentials.json 读取")
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    if args.base_url and args.api_key:
        base_url, api_key = args.base_url, args.api_key
    else:
        creds = load_credentials(script_dir)
        base_url, api_key = creds["base_url"], creds["api_key"]

    print(f"[backfill-emails-ai] base={base_url} limit={args.limit} batch_cap={args.batch or 'unlimited'}")
    total_candidates = total_extracted = total_none = total_failed = 0
    batches = 0
    while True:
        result = call_extract(base_url, api_key, args.limit)
        batches += 1
        cand, ext, none, failed = (
            result.get("candidates", 0),
            result.get("extracted", 0),
            result.get("none", 0),
            result.get("failed", 0),
        )
        total_candidates += cand
        total_extracted += ext
        total_none += none
        total_failed += failed
        print(
            f"[batch {batches}] candidates={cand} extracted={ext} none={none} failed={failed} "
            f"| 累计 candidates={total_candidates} extracted={total_extracted}"
        )
        for item in result.get("results", []):
            mark = item.get("email") or f"<无邮箱>{'  ' + str(item.get('error'))[:60] if item.get('error') else ''}"
            print(f"    - {item.get('id')} -> {mark}")
        if cand == 0 or (args.batch and batches >= args.batch):
            break
        time.sleep(args.interval)

    print(
        f"[done] batches={batches} 累计 candidates={total_candidates} "
        f"extracted={total_extracted} none={total_none} failed={total_failed}"
    )
    if total_failed > 0:
        print("[warn] 存在失败条目，可稍后重跑本脚本（失败的不会写检查标记，会自动重试）")


if __name__ == "__main__":
    main()
