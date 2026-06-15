#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apps.api.app.config import get_settings
from apps.api.app.core.demo_fixtures import LEGACY_SHARED_SESSION_ID, ensure_demo_session, load_records
from apps.api.app.db import init_db, make_session_factory


def main() -> int:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.asset_root.mkdir(parents=True, exist_ok=True)
    session_factory = make_session_factory(settings)
    init_db(session_factory)

    session_id = os.environ.get("TTB_DEMO_SESSION_ID", LEGACY_SHARED_SESSION_ID)
    reset_review_state = os.environ.get("TTB_SEED_RESET_REVIEW_STATE", "1") != "0"
    with session_factory() as session:
        ensure_demo_session(session, session_id, reset_review_state=reset_review_state)

    print(f"Seeded {len(load_records())} public COLA demo application(s) for {session_id} into {settings.database_url}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
