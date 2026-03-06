"""Pydantic schemas for structured LLM outputs via Instructor.

These schemas define the expected response shapes for various LLM calls
that benefit from validated, typed outputs instead of raw string parsing.
"""

from pydantic import BaseModel, Field, field_validator


class ProjectName(BaseModel):
    """Schema for LLM-generated project names."""

    name: str = Field(
        ...,
        min_length=2,
        max_length=60,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9 .&+\-']{0,58}[A-Za-z0-9]$",
        description="A concise project name (2-4 words) based on the user's prompt",
    )

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, v: str) -> str:
        if isinstance(v, str):
            return v.strip(" ")
        return v
