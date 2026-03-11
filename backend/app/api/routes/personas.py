import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Message,
    Persona,
    PersonaAccess,
    PersonaAccessCreate,
    PersonaAccessPublic,
    PersonaCreate,
    PersonaPublic,
    PersonaRolePublic,
    PersonasPublic,
    PersonaUpdate,
    Team,
    TeamMembership,
)
from app.services.access import (
    ROLE_PRIORITY,
    get_persona_role,
    get_team_role,
    has_min_role,
    normalize_role,
)

router = APIRouter(prefix="/personas", tags=["personas"])


def _validate_role(*, role: str) -> str:
    cleaned = normalize_role(role=role)
    if cleaned not in ROLE_PRIORITY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role. Must be member, admin, or owner.",
        )
    return cleaned


@router.get("", response_model=PersonasPublic)
def read_personas(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
) -> Any:
    shared_persona_ids = (
        select(PersonaAccess.persona_id)
        .join(
            TeamMembership,
            col(PersonaAccess.team_id) == col(TeamMembership.team_id),
        )
        .where(col(TeamMembership.user_id) == current_user.id)
    )

    statement = (
        select(Persona)
        .where(
            or_(
                col(Persona.user_id) == current_user.id,
                col(Persona.id).in_(shared_persona_ids),
            )
        )
        .order_by(col(Persona.created_at).desc().nulls_last())
        .offset(skip)
        .limit(limit)
    )
    count_statement = (
        select(func.count())
        .select_from(Persona)
        .where(
            or_(
                col(Persona.user_id) == current_user.id,
                col(Persona.id).in_(shared_persona_ids),
            )
        )
    )

    personas = session.exec(statement).all()
    count = session.exec(count_statement).one()
    return PersonasPublic(data=list(personas), count=count)


@router.post("", response_model=PersonaPublic, status_code=status.HTTP_201_CREATED)
def create_persona(
    *, session: SessionDep, current_user: CurrentUser, persona_in: PersonaCreate
) -> Any:
    persona = Persona.model_validate(persona_in, update={"user_id": current_user.id})
    session.add(persona)
    session.commit()
    session.refresh(persona)
    return persona


@router.get("/{persona_id}", response_model=PersonaPublic)
def read_persona(
    *, session: SessionDep, current_user: CurrentUser, persona_id: uuid.UUID
) -> Any:
    persona = session.get(Persona, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    role = get_persona_role(
        session=session,
        persona_id=persona_id,
        user_id=current_user.id,
    )
    if not role:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    return persona


@router.get("/{persona_id}/role", response_model=PersonaRolePublic)
def read_persona_role(
    *, session: SessionDep, current_user: CurrentUser, persona_id: uuid.UUID
) -> Any:
    persona = session.get(Persona, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    role = get_persona_role(
        session=session,
        persona_id=persona_id,
        user_id=current_user.id,
    )
    if not role:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    return PersonaRolePublic(role=role)


@router.put("/{persona_id}", response_model=PersonaPublic)
def update_persona(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    persona_id: uuid.UUID,
    persona_in: PersonaUpdate,
) -> Any:
    persona = session.get(Persona, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    if persona.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    update_data = persona_in.model_dump(exclude_unset=True)
    persona.sqlmodel_update(update_data)
    session.add(persona)
    session.commit()
    session.refresh(persona)
    return persona


@router.delete("/{persona_id}", response_model=Message)
def delete_persona(
    *, session: SessionDep, current_user: CurrentUser, persona_id: uuid.UUID
) -> Any:
    persona = session.get(Persona, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    if persona.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    session.delete(persona)
    session.commit()
    return Message(message="Persona deleted successfully")


@router.post("/{persona_id}/share", response_model=PersonaAccessPublic)
def share_persona(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    persona_id: uuid.UUID,
    access_in: PersonaAccessCreate,
) -> Any:
    persona = session.get(Persona, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    if persona.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    team = session.get(Team, access_in.team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    team_role = get_team_role(
        session=session,
        team_id=access_in.team_id,
        user_id=current_user.id,
    )
    if not team_role or not has_min_role(role=team_role, minimum="admin"):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    role = _validate_role(role=access_in.role)

    access = session.exec(
        select(PersonaAccess).where(
            PersonaAccess.persona_id == persona_id,
            PersonaAccess.team_id == access_in.team_id,
        )
    ).first()

    if access:
        access.role = role
        access.granted_by_user_id = current_user.id
    else:
        access = PersonaAccess(
            persona_id=persona_id,
            team_id=access_in.team_id,
            granted_by_user_id=current_user.id,
            role=role,
        )

    session.add(access)
    session.commit()
    session.refresh(access)
    return access


@router.get("/{persona_id}/access", response_model=list[PersonaAccessPublic])
def list_persona_access(
    *, session: SessionDep, current_user: CurrentUser, persona_id: uuid.UUID
) -> Any:
    persona = session.get(Persona, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    if persona.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    access_rows = session.exec(
        select(PersonaAccess).where(PersonaAccess.persona_id == persona_id)
    ).all()
    return list(access_rows)


@router.delete("/{persona_id}/access/{team_id}", response_model=Message)
def delete_persona_access(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    persona_id: uuid.UUID,
    team_id: uuid.UUID,
) -> Any:
    persona = session.get(Persona, persona_id)
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")

    if persona.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    access = session.exec(
        select(PersonaAccess).where(
            PersonaAccess.persona_id == persona_id,
            PersonaAccess.team_id == team_id,
        )
    ).first()
    if not access:
        raise HTTPException(status_code=404, detail="Persona access not found")

    session.delete(access)
    session.commit()
    return Message(message="Persona access removed")
