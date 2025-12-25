from typing import Dict, Any
from ..repos import user_repo


def ensure_user_exists(user_id: str, email: str | None = None) -> Dict[str, Any]:
    u = user_repo.get_user_by_id(user_id)
    if u:
        return u
    new_user = {"userId": user_id, "email": email or "", "name": "", "createdAt": "now"}
    user_repo.create_user(new_user)
    return new_user


def update_profile(user_id: str, updates: Dict[str, Any]) -> None:
    user_repo.update_user(user_id, updates)
