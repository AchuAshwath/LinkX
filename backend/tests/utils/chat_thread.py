import uuid

from sqlmodel import Session

from app import crud
from app.models import ChatThread, ChatThreadCreate
from tests.utils.user import create_random_user
from tests.utils.utils import random_lower_string


def create_random_chat_thread(
    db: Session, *, owner_id: uuid.UUID | None = None
) -> ChatThread:
    if not owner_id:
        user = create_random_user(db)
        owner_id = user.id
    assert owner_id is not None
    prompt = random_lower_string()
    thread_in = ChatThreadCreate(origin="manual", prompt=prompt)
    return crud.create_chat_thread(session=db, thread_in=thread_in, owner_id=owner_id)
