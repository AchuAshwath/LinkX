"""Bounded transport contracts for temporary browser reading."""

import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.ai_observation_image import decode_jpeg_data_url, jpeg_dimensions


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BrowserFrame(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    sequence: int = Field(gt=0)
    captured_at: datetime
    width: int = Field(gt=0, le=2048)
    height: int = Field(gt=0, le=2048)
    image_data_url: str = Field(max_length=2_000_000, repr=False)

    @model_validator(mode="after")
    def validate_image(self) -> Self:
        if self.captured_at.tzinfo is None:
            raise ValueError("captured_at must include a timezone")
        dimensions = jpeg_dimensions(
            data=decode_jpeg_data_url(data_url=self.image_data_url)
        )
        if dimensions != (self.width, self.height):
            raise ValueError("image dimensions do not match metadata")
        return self


class BrowserNote(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    sequence: int = Field(gt=0)
    text: str = Field(max_length=8000)
    model: str = Field(min_length=1, max_length=100)
    uncertainty: str = Field(default="", max_length=2000)


class BrowserMemory(StrictModel):
    summary: str = Field(default="", max_length=8192)
    notes: list[BrowserNote] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def validate_size(self) -> Self:
        payload = {
            "summary": self.summary,
            "notes": [n.model_dump() for n in self.notes],
        }
        encoded = json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        ).encode()
        if len(encoded) > 32768:
            raise ValueError("browser memory exceeds byte limit")
        ids = [note.id for note in self.notes]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate note IDs")
        return self


class BrowserContext(BrowserMemory):
    session_id: UUID
    generation: int = Field(gt=0)
    cutoff: int = Field(ge=0)
    pending_frames: list[BrowserFrame] = Field(default_factory=list, max_length=2)
    current_view: BrowserFrame | None = Field(
        default=None,
        description="Reserved for the paired-image prototype; browser-chat rejects non-null current views until that trial is enabled.",
    )
    gap_count: int = Field(default=0, ge=0, le=200)

    @model_validator(mode="after")
    def validate_cutoff(self) -> Self:
        _validate_pending_ids(context=self)
        _require_cutoff(items=self.notes, cutoff=self.cutoff)
        _require_cutoff(items=self.pending_frames, cutoff=self.cutoff)
        return self


class ReadRequest(StrictModel):
    operation_id: UUID
    model: str = Field(min_length=1, max_length=100)
    frame: BrowserFrame


class ReadResponse(StrictModel):
    operation_id: UUID
    note: BrowserNote


class CompactRequest(BrowserMemory):
    operation_id: UUID
    model: str = Field(min_length=1, max_length=100)


class CompactResponse(StrictModel):
    operation_id: UUID
    summary: str = Field(max_length=8192)


class EvaluationInput(StrictModel):
    message: str = Field(min_length=1, max_length=25000)
    model: str = Field(min_length=1, max_length=100)
    context: BrowserContext
    history: list[dict[str, Any]] = Field(default_factory=list)


class EvaluationResult(StrictModel):
    decision: Literal["answer", "wait", "insufficient"]
    answer: str = Field(default="", max_length=25000)
    evidence_ids: list[str] = Field(default_factory=list, max_length=200)
    requires_complete: bool = False
    answer_basis: Literal["browser", "conversation", "general", "mixed"] = "browser"


class BrowserChatRequest(StrictModel):
    message: str = Field(min_length=1, max_length=25000)
    model: str = Field(min_length=1, max_length=100)
    request_id: UUID
    browser_context: BrowserContext

    @model_validator(mode="after")
    def require_current_view_trial(self) -> Self:
        if self.browser_context.current_view is not None:
            raise ValueError(
                "Current-view image input is not enabled for browser questions"
            )
        if not self.message.strip():
            raise ValueError("Message must contain text")
        return self


class OperationStatus(StrictModel):
    operation_id: UUID
    state: Literal["active", "settled", "unknown"]
    cancelled: bool = False


def _require_cutoff(
    *, items: Sequence[BrowserNote | BrowserFrame], cutoff: int
) -> None:
    if any(item.sequence > cutoff for item in items):
        raise ValueError("browser content exceeds frozen cutoff")


def _validate_pending_ids(*, context: BrowserContext) -> None:
    pending_ids = [frame.id for frame in context.pending_frames]
    if len(pending_ids) != len(set(pending_ids)):
        raise ValueError("duplicate pending frame IDs")
    note_ids = {note.id for note in context.notes}
    if note_ids.intersection(pending_ids):
        raise ValueError("pending frames already have notes")
