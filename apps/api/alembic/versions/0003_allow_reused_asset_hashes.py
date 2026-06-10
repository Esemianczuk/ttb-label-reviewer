"""allow reused asset hashes across applications

Revision ID: 0003_allow_reused_asset_hashes
Revises: 0002_worker_join_tokens
Create Date: 2026-06-10
"""

from __future__ import annotations

from alembic import op

revision = "0003_allow_reused_asset_hashes"
down_revision = "0002_worker_join_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("assets") as batch_op:
        batch_op.drop_constraint("uq_assets_sha256", type_="unique")


def downgrade() -> None:
    with op.batch_alter_table("assets") as batch_op:
        batch_op.create_unique_constraint("uq_assets_sha256", ["sha256"])
