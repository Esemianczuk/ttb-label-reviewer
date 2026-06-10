"""worker join tokens and secrets

Revision ID: 0002_worker_join_tokens
Revises: 0001_initial
Create Date: 2026-06-10
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_worker_join_tokens"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workers", sa.Column("worker_secret_hash", sa.String(length=128), nullable=True))
    op.create_table(
        "worker_join_tokens",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("worker_id", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_worker_join_tokens_token_hash"),
    )
    op.create_index("ix_worker_join_tokens_token_hash", "worker_join_tokens", ["token_hash"])
    op.create_index("ix_worker_join_tokens_expires_at", "worker_join_tokens", ["expires_at"])
    op.create_index("ix_worker_join_tokens_worker_id", "worker_join_tokens", ["worker_id"])


def downgrade() -> None:
    op.drop_index("ix_worker_join_tokens_worker_id", table_name="worker_join_tokens")
    op.drop_index("ix_worker_join_tokens_expires_at", table_name="worker_join_tokens")
    op.drop_index("ix_worker_join_tokens_token_hash", table_name="worker_join_tokens")
    op.drop_table("worker_join_tokens")
    op.drop_column("workers", "worker_secret_hash")
