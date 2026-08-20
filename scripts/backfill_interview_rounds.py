#!/usr/bin/env python3
"""将旧 interviews.result2/evaluation2/status2 转成独立二面记录。

默认只读取 JSON/JSONL 并输出 JSONL，不连接 D1，也不会修改数据。
只有显式传入 --emit-sql 才输出可人工审阅的 INSERT/UPDATE SQL。
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Iterable


def round_two_id(round_one_id: str) -> str:
    return f"{round_one_id}-round-2"


def build_round_two(row: dict[str, Any]) -> dict[str, Any] | None:
    result = str(row.get("result2") or "pending").strip() or "pending"
    evaluation = str(row.get("evaluation2") or "")
    status2 = str(row.get("status2") or "pending").strip() or "pending"
    if result == "pending" and status2 == "pending" and not evaluation:
        return None

    source_id = str(row.get("id") or "").strip()
    resume_id = str(row.get("resume_id") or "").strip()
    if not source_id or not resume_id:
        raise ValueError("legacy interview row requires id and resume_id")

    terminal = result in {"passed", "failed", "rejected"} or status2 in {"completed", "passed", "failed"}
    return {
        "id": round_two_id(source_id),
        "resume_id": resume_id,
        "position_id": row.get("position_id"),
        "candidate_name": row.get("candidate_name") or "",
        "position_applied": row.get("position_applied") or "",
        "round": 2,
        "interviewer": row.get("secondary_interviewer") or "",
        "primary_interviewer": row.get("secondary_interviewer") or "",
        "secondary_interviewer": "",
        "result": result,
        "evaluation": evaluation,
        "status": "completed" if terminal else "awaiting_schedule",
        "schedule_status": "scheduled" if terminal and row.get("interview_time") else "not_ready",
        "previous_interview_id": source_id,
        "next_interview_id": None,
        "version": 1,
    }


def migrate_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        converted = build_round_two(row)
        if converted:
            result.append(converted)
    return result


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    return "'" + str(value).replace("'", "''") + "'"


def emit_sql(rows: Iterable[dict[str, Any]]) -> str:
    statements: list[str] = ["-- 仅供人工审阅；执行前必须完成 audit_interview_rounds.sql。"]
    for row in rows:
        columns = [
            "id", "resume_id", "candidate_name", "position_id", "position_applied", "round",
            "interviewer", "primary_interviewer", "secondary_interviewer", "result", "evaluation",
            "status", "schedule_status", "previous_interview_id", "next_interview_id", "version",
        ]
        values = [row.get(column) for column in columns]
        statements.append(
            "INSERT INTO interviews (" + ", ".join(columns) + ") VALUES ("
            + ", ".join(sql_literal(value) for value in values)
            + ") ON CONFLICT(id) DO NOTHING;"
        )
        statements.append(
            "UPDATE interviews SET next_interview_id = "
            + sql_literal(row["id"])
            + ", updated_at = datetime('now') WHERE id = "
            + sql_literal(row["previous_interview_id"])
            + ";"
        )
    return "\n".join(statements) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?", default="-", help="JSON array or JSONL file; default reads stdin")
    parser.add_argument("--emit-sql", action="store_true", help="output SQL instead of JSONL")
    args = parser.parse_args()
    source = sys.stdin.read() if args.input == "-" else open(args.input, encoding="utf-8").read()
    try:
        parsed = json.loads(source)
        rows = parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        rows = [json.loads(line) for line in source.splitlines() if line.strip()]
    converted = migrate_rows(rows)
    if args.emit_sql:
        sys.stdout.write(emit_sql(converted))
    else:
        for row in converted:
            sys.stdout.write(json.dumps(row, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
