from typing import Optional, Dict, Any
from ..config import USERS_TABLE
from .ddb import table, get_item, put_item, query_gsi

t = table(USERS_TABLE)


def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    return get_item(t, {"userId": user_id})


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    items = query_gsi(t, "email-index", "email", email)
    return items[0] if items else None


def create_user(user: Dict[str, Any]) -> None:
    put_item(t, user)


def update_user(user_id: str, updates: Dict[str, Any]) -> None:
    # MVP: read-modify-write
    existing = get_user_by_id(user_id) or {"userId": user_id}
    existing.update(updates)
    put_item(t, existing)
