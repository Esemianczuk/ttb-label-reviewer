from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models


DEMO_ORGANIZATION = {
    "id": "00000000-0000-0000-0000-000000000100",
    "name": "Demo Beverage Co.",
    "type": "producer",
}

DEMO_USERS = {
    "applicant": {
        "id": "00000000-0000-0000-0000-000000000001",
        "email": "applicant@example.local",
        "display_name": "Demo Applicant",
        "role": "applicant",
        "status": "active",
        "organization_id": DEMO_ORGANIZATION["id"],
    },
    "reviewer": {
        "id": "00000000-0000-0000-0000-000000000002",
        "email": "reviewer@example.local",
        "display_name": "Demo Reviewer",
        "role": "reviewer",
        "status": "active",
        "organization_id": None,
    },
    "admin": {
        "id": "00000000-0000-0000-0000-000000000003",
        "email": "admin@example.local",
        "display_name": "Demo Admin",
        "role": "admin",
        "status": "active",
        "organization_id": None,
    },
}


def seed_demo_identity(session: Session) -> None:
    organization = session.get(models.Organization, DEMO_ORGANIZATION["id"])
    if organization is None:
        organization = models.Organization(**DEMO_ORGANIZATION)
        session.add(organization)
    else:
        organization.name = DEMO_ORGANIZATION["name"]
        organization.type = DEMO_ORGANIZATION["type"]

    for user_seed in DEMO_USERS.values():
        user = session.scalar(select(models.User).where(models.User.email == user_seed["email"]))
        if user is None:
            user = models.User(**user_seed)
            session.add(user)
        else:
            user.id = user_seed["id"]
            user.display_name = user_seed["display_name"]
            user.role = user_seed["role"]
            user.status = user_seed["status"]
            user.organization_id = user_seed["organization_id"]
