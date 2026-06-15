"""Collector constants.

The TTB Public COLA Registry routing has changed before. Keep the host/path in
one place so a future registry move does not require hunting through scripts.
"""

from pathlib import Path

PUBLIC_DETAIL_BASE_URL = "https://www.ttbonline.gov/colasonline/viewColaDetails.do"
PUBLIC_SEARCH_BASE_URL = "https://www.ttbonline.gov/colasonline/publicSearchColasBasic.do"

DATA_GOV_DETAIL_QUERY_PATTERN = "?action=publicDisplaySearchBasic&ttbid=<TTB_ID>"

USER_AGENT = (
    "ttb-label-reviewer-fixture-collector/0.1 "
    "(public fixture builder; contact: replace-with-project-contact)"
)

REQUEST_TIMEOUT_SECONDS = 30
DEFAULT_DELAY_SECONDS = 2.0
MAX_ASSET_BYTES = 50 * 1024 * 1024

TOOL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SEARCH_CACHE_DIR = TOOL_DIR / "cache" / "search"
