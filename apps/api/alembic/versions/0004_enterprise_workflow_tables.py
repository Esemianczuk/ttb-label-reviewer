"""enterprise workflow tables

Revision ID: 0004_enterprise_workflow_tables
Revises: 0003_allow_reused_asset_hashes
Create Date: 2026-06-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_enterprise_workflow_tables"
down_revision = "0003_allow_reused_asset_hashes"
branch_labels = None
depends_on = None

json_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_organizations_name", "organizations", ["name"])
    op.create_index("ix_organizations_type", "organizations", ["type"])

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("organization_id", sa.String(length=36), sa.ForeignKey("organizations.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_role", "users", ["role"])
    op.create_index("ix_users_status", "users", ["status"])
    op.create_index("ix_users_organization_id", "users", ["organization_id"])

    with op.batch_alter_table("applications") as batch_op:
        batch_op.add_column(
            sa.Column(
                "owner_user_id",
                sa.String(length=36),
                sa.ForeignKey("users.id", name="fk_applications_owner_user_id_users"),
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "organization_id",
                sa.String(length=36),
                sa.ForeignKey("organizations.id", name="fk_applications_organization_id_organizations"),
                nullable=True,
            )
        )
        batch_op.create_index("ix_applications_owner_user_id", ["owner_user_id"])
        batch_op.create_index("ix_applications_organization_id", ["organization_id"])

    op.create_table(
        "application_versions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("application_id", sa.String(length=36), sa.ForeignKey("applications.id"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("expected_fields", json_type, nullable=False),
        sa.Column("metadata_json", json_type, nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("application_id", "version_number", name="uq_application_versions_application_version"),
    )
    op.create_index("ix_application_versions_application_id", "application_versions", ["application_id"])
    op.create_index("ix_application_versions_created_by_user_id", "application_versions", ["created_by_user_id"])

    op.create_table(
        "review_decisions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("review_id", sa.String(length=36), sa.ForeignKey("reviews.id"), nullable=False),
        sa.Column("field_key", sa.String(length=120), nullable=False),
        sa.Column("auto_status", sa.String(length=40), nullable=False),
        sa.Column("reviewer_status", sa.String(length=40), nullable=True),
        sa.Column("effective_status", sa.String(length=40), nullable=False),
        sa.Column("reviewer_note", sa.Text(), nullable=True),
        sa.Column("reviewer_user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("review_id", "field_key", name="uq_review_decisions_review_field"),
    )
    op.create_index("ix_review_decisions_review_id", "review_decisions", ["review_id"])
    op.create_index("ix_review_decisions_field_key", "review_decisions", ["field_key"])
    op.create_index("ix_review_decisions_effective_status", "review_decisions", ["effective_status"])
    op.create_index("ix_review_decisions_reviewer_user_id", "review_decisions", ["reviewer_user_id"])

    op.create_table(
        "correction_requests",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("application_id", sa.String(length=36), sa.ForeignKey("applications.id"), nullable=False),
        sa.Column("review_id", sa.String(length=36), sa.ForeignKey("reviews.id"), nullable=True),
        sa.Column("requested_by_user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("field_keys", json_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_correction_requests_application_id", "correction_requests", ["application_id"])
    op.create_index("ix_correction_requests_review_id", "correction_requests", ["review_id"])
    op.create_index("ix_correction_requests_requested_by_user_id", "correction_requests", ["requested_by_user_id"])
    op.create_index("ix_correction_requests_status", "correction_requests", ["status"])

    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("actor_user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("actor_role", sa.String(length=40), nullable=False),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("entity_type", sa.String(length=120), nullable=False),
        sa.Column("entity_id", sa.String(length=120), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("before_json", json_type, nullable=True),
        sa.Column("after_json", json_type, nullable=True),
        sa.Column("metadata_json", json_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_events_actor_user_id", "audit_events", ["actor_user_id"])
    op.create_index("ix_audit_events_actor_role", "audit_events", ["actor_role"])
    op.create_index("ix_audit_events_event_type", "audit_events", ["event_type"])
    op.create_index("ix_audit_events_entity_type", "audit_events", ["entity_type"])
    op.create_index("ix_audit_events_entity_id", "audit_events", ["entity_id"])
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"])

    op.create_table(
        "settings",
        sa.Column("key", sa.String(length=120), primary_key=True),
        sa.Column("value_json", json_type, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("settings")
    op.drop_table("audit_events")
    op.drop_table("correction_requests")
    op.drop_table("review_decisions")
    op.drop_table("application_versions")
    with op.batch_alter_table("applications") as batch_op:
        batch_op.drop_index("ix_applications_organization_id")
        batch_op.drop_index("ix_applications_owner_user_id")
        batch_op.drop_column("organization_id")
        batch_op.drop_column("owner_user_id")
    op.drop_table("users")
    op.drop_table("organizations")
