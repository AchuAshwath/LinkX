import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import User


def test_create_user(client: TestClient, db: Session) -> None:
    email = f"pollo-{uuid.uuid4().hex}@listo.com"
    r = client.post(
        f"{settings.API_V1_STR}/private/users/",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Pollo Listo",
        },
    )

    assert r.status_code == 200

    data = r.json()

    user = db.exec(select(User).where(User.id == data["id"])).first()

    assert user
    assert user.email == email
    assert user.full_name == "Pollo Listo"
