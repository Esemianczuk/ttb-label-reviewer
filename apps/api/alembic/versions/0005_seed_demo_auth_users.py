"""seed demo auth users

Revision ID: 0005_seed_demo_auth_users
Revises: 0004_enterprise_workflow_tables
Create Date: 2026-06-11
"""

from __future__ import annotations

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "0005_seed_demo_auth_users"
down_revision = "0004_enterprise_workflow_tables"
branch_labels = None
depends_on = None

DEMO_ORG_ID = "00000000-0000-0000-0000-000000000100"
DEMO_USER_IDS = [
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
    "00000000-0000-0000-0000-000000000003",
]
seeded_at = datetime(2026, 6, 11, tzinfo=timezone.utc)


def upgrade() -> None:
    organizations = sa.table(
        "organizations",
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("type", sa.String),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    users = sa.table(
        "users",
        sa.column("id", sa.String),
        sa.column("email", sa.String),
        sa.column("display_name", sa.String),
        sa.column("role", sa.String),
        sa.column("status", sa.String),
        sa.column("organization_id", sa.String),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        organizations,
        [
            {
                "id": DEMO_ORG_ID,
                "name": "Demo Beverage Co.",
                "type": "producer",
                "created_at": seeded_at,
            }
        ],
    )
    op.bulk_insert(
        users,
        [
            {
                "id": "00000000-0000-0000-0000-000000000001",
                "email": "applicant@example.local",
                "display_name": "Demo Applicant",
                "role": "applicant",
                "status": "active",
                "organization_id": DEMO_ORG_ID,
                "created_at": seeded_at,
                "updated_at": seeded_at,
            },
            {
                "id": "00000000-0000-0000-0000-000000000002",
                "email": "reviewer@example.local",
                "display_name": "Demo Reviewer",
                "role": "reviewer",
                "status": "active",
                "organization_id": None,
                "created_at": seeded_at,
                "updated_at": seeded_at,
            },
            {
                "id": "00000000-0000-0000-0000-000000000003",
                "email": "admin@example.local",
                "display_name": "Demo Admin",
                "role": "admin",
                "status": "active",
                "organization_id": None,
                "created_at": seeded_at,
                "updated_at": seeded_at,
            },
        ],
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM users WHERE id IN :ids").bindparams(sa.bindparam("ids", expanding=True)), {"ids": DEMO_USER_IDS})
    bind.execute(sa.text("DELETE FROM organizations WHERE id = :id"), {"id": DEMO_ORG_ID})
