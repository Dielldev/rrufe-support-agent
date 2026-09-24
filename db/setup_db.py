#!/usr/bin/env python3
"""Build shop.db from schema.sql + seed.sql, print row counts per table, then run
every helper query from queries.sql for orders 1048 and 1031.

Usage:  python setup_db.py [--today YYYY-MM-DD]

The seed data is anchored to 2026-09-24, so that is the default "today".
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "shop.db"
SEED_TODAY = "2026-09-24"
DEMO_ORDERS = (1048, 1031)


def load_queries(path: Path) -> dict[str, str]:
    """Split queries.sql on '-- name: <id>' marker lines."""
    queries: dict[str, list[str]] = {}
    current = None
    for line in path.read_text(encoding="utf-8").splitlines():
        marker = re.match(r"--\s*name:\s*(\w+)\s*$", line)
        if marker:
            current = queries.setdefault(marker.group(1), [])
        elif current is not None:
            current.append(line)
    return {name: "\n".join(lines).strip() for name, lines in queries.items()}


def build_db() -> sqlite3.Connection:
    DB_PATH.unlink(missing_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    for script in ("schema.sql", "seed.sql"):
        try:
            con.executescript((HERE / script).read_text(encoding="utf-8"))
        except sqlite3.Error as exc:
            sys.exit(f"ERROR in {script}: {exc}")
    return con


def print_row_counts(con: sqlite3.Connection) -> None:
    tables = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")]
    width = max(len(t) for t in tables)
    print("Row counts:")
    for table in tables:
        count = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        print(f"  {table:<{width}}  {count:>4}")


def check_integrity(con: sqlite3.Connection) -> None:
    violations = con.execute("PRAGMA foreign_key_check").fetchall()
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    if violations or integrity != "ok":
        sys.exit(f"Integrity problem: fk_violations={len(violations)} integrity_check={integrity}")
    print("\nforeign_key_check: ok   integrity_check: ok")


def run(con, queries, name, **params):
    print(f"\n-- {name}({', '.join(f'{k}={v!r}' for k, v in params.items())})")
    return con.execute(queries[name], params).fetchall()


def show(rows: list[sqlite3.Row]) -> None:
    """One 'column  value' line per field, blank line between rows."""
    if not rows:
        print("   (no rows)")
    for i, row in enumerate(rows):
        if i:
            print()
        for key in row.keys():
            print(f"   {key:<24} {row[key]}")


def show_table(rows: list[sqlite3.Row]) -> None:
    """Column-aligned table, for wide multi-row results."""
    if not rows:
        print("   (no rows)")
        return
    cols = rows[0].keys()
    widths = [max(len(c), *(len(str(r[c])) for r in rows)) for c in cols]
    print("   " + "  ".join(f"{c:<{w}}" for c, w in zip(cols, widths)))
    for r in rows:
        print("   " + "  ".join(f"{str(r[c]):<{w}}" for c, w in zip(cols, widths)))


def sender_cases(con, order_id):
    """Every handle the real owner could write from, plus each unknown sender."""
    owner = con.execute(
        "SELECT c.phone, c.email, c.instagram_handle FROM orders o "
        "JOIN customers c ON c.customer_id = o.customer_id WHERE o.order_id = ?",
        (order_id,)).fetchone()
    cases = [(f"owner {key}", owner[key]) for key in owner.keys() if owner[key]]
    cases += [("unknown sender", r[0]) for r in con.execute(
        "SELECT DISTINCT sender_handle FROM conversations WHERE customer_id IS NULL")]
    return cases


def demo_order(con, queries, order_id, today):
    print(f"\n{'=' * 70}\nORDER #{order_id}   (today = {today})\n{'=' * 70}")
    show(run(con, queries, "order_lookup", order_id=order_id))
    show(run(con, queries, "is_shipment_late", order_id=order_id, today=today))
    show(run(con, queries, "return_eligibility", order_id=order_id, today=today))

    customer_id = con.execute(
        "SELECT customer_id FROM orders WHERE order_id = ?", (order_id,)).fetchone()[0]
    show(run(con, queries, "previous_conversations", customer_id=customer_id, before=None))

    print("\n-- does_sender_match_order_owner")
    for label, handle in sender_cases(con, order_id):
        row = con.execute(queries["does_sender_match_order_owner"],
                          {"order_id": order_id, "sender_handle": handle}).fetchone()
        print(f"   {label:<24} {handle:<28} -> {row['sender_matches_owner']}")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):  # Albanian text on legacy Windows consoles
        sys.stdout.reconfigure(errors="replace")

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--today", default=SEED_TODAY, help="reference date (default: %(default)s)")
    today = parser.parse_args().today

    con = build_db()
    queries = load_queries(HERE / "queries.sql")
    print(f"Built {DB_PATH.name} (SQLite {sqlite3.sqlite_version})\n")
    print_row_counts(con)
    check_integrity(con)

    for order_id in DEMO_ORDERS:
        demo_order(con, queries, order_id, today)

    print(f"\n{'=' * 70}\nPREVIOUS CONVERSATIONS, ALL CUSTOMERS\n{'=' * 70}")
    show_table(run(con, queries, "previous_conversations", customer_id=None, before=None))
    con.close()


if __name__ == "__main__":
    main()
