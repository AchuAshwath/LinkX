import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Message,
    Team,
    TeamCreate,
    TeamMembership,
    TeamMembershipCreate,
    TeamMembershipPublic,
    TeamPublic,
    TeamsPublic,
    TeamUpdate,
    User,
)
from app.services.access import ROLE_PRIORITY, get_team_role, has_min_role, normalize_role

router = APIRouter(prefix="/teams", tags=["teams"])


def _validate_role(*, role: str) -> str:
    cleaned = normalize_role(role=role)
    if cleaned not in ROLE_PRIORITY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role. Must be member, admin, or owner.",
        )
    return cleaned


@router.get("", response_model=TeamsPublic)
def read_teams(
    session: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100
) -> Any:
    statement = (
        select(Team)
        .join(TeamMembership, TeamMembership.team_id == Team.id)
        .where(TeamMembership.user_id == current_user.id)
        .order_by(col(Team.created_at).desc().nulls_last())
        .offset(skip)
        .limit(limit)
    )
    count_statement = (
        select(func.count())
        .select_from(Team)
        .join(TeamMembership, TeamMembership.team_id == Team.id)
        .where(TeamMembership.user_id == current_user.id)
    )

    teams = session.exec(statement).all()
    count = session.exec(count_statement).one()
    return TeamsPublic(data=list(teams), count=count)


@router.post("", response_model=TeamPublic, status_code=status.HTTP_201_CREATED)
def create_team(
    *, session: SessionDep, current_user: CurrentUser, team_in: TeamCreate
) -> Any:
    team = Team.model_validate(team_in, update={"owner_user_id": current_user.id})
    session.add(team)
    session.commit()
    session.refresh(team)

    membership = TeamMembership(
        user_id=current_user.id,
        team_id=team.id,
        role="owner",
    )
    session.add(membership)
    session.commit()
    return team


@router.get("/{team_id}", response_model=TeamPublic)
def read_team(
    *, session: SessionDep, current_user: CurrentUser, team_id: uuid.UUID
) -> Any:
    team = session.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    role = get_team_role(session=session, team_id=team_id, user_id=current_user.id)
    if not role:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    return team


@router.put("/{team_id}", response_model=TeamPublic)
def update_team(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    team_id: uuid.UUID,
    team_in: TeamUpdate,
) -> Any:
    team = session.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    role = get_team_role(session=session, team_id=team_id, user_id=current_user.id)
    if not role or not has_min_role(role=role, minimum="admin"):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    update_data = team_in.model_dump(exclude_unset=True)
    team.sqlmodel_update(update_data)
    session.add(team)
    session.commit()
    session.refresh(team)
    return team


@router.delete("/{team_id}", response_model=Message)
def delete_team(
    *, session: SessionDep, current_user: CurrentUser, team_id: uuid.UUID
) -> Any:
    team = session.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    role = get_team_role(session=session, team_id=team_id, user_id=current_user.id)
    if not role or not has_min_role(role=role, minimum="owner"):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    session.delete(team)
    session.commit()
    return Message(message="Team deleted successfully")


@router.post("/{team_id}/members", response_model=TeamMembershipPublic)
def add_team_member(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    team_id: uuid.UUID,
    member_in: TeamMembershipCreate,
) -> Any:
    team = session.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    role = get_team_role(session=session, team_id=team_id, user_id=current_user.id)
    if not role or not has_min_role(role=role, minimum="admin"):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    user = session.get(User, member_in.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    target_role = _validate_role(role=member_in.role)

    membership = session.exec(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == member_in.user_id,
        )
    ).first()

    if membership:
        membership.role = target_role
    else:
        membership = TeamMembership(
            user_id=member_in.user_id,
            team_id=team_id,
            role=target_role,
        )

    session.add(membership)
    session.commit()
    session.refresh(membership)
    return TeamMembershipPublic(
        id=membership.id,
        user_id=membership.user_id,
        team_id=membership.team_id,
        role=membership.role,
    )


@router.delete("/{team_id}/members/{user_id}", response_model=Message)
def remove_team_member(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    team_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Any:
    team = session.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    role = get_team_role(session=session, team_id=team_id, user_id=current_user.id)
    if not role or not has_min_role(role=role, minimum="admin"):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    membership = session.exec(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user_id,
        )
    ).first()

    if not membership:
        raise HTTPException(status_code=404, detail="Team member not found")

    if normalize_role(role=membership.role) == "owner":
        owner_count = session.exec(
            select(func.count()).select_from(TeamMembership).where(
                TeamMembership.team_id == team_id,
                TeamMembership.role == "owner",
            )
        ).one()
        if owner_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove the last owner",
            )

    session.delete(membership)
    session.commit()
    return Message(message="Team member removed")
