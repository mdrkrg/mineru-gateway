import uuid


def to_uuid(value: str | uuid.UUID) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def get_uuid() -> uuid.UUID:
    return uuid.uuid7()
