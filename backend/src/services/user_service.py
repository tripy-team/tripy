from typing import Dict, Any
from ..repos import user_repo


def ensure_user_exists(user_id: str, email: str | None = None) -> Dict[str, Any]:
    u = user_repo.get_user_by_id(user_id)
    if u:
        # Update email if provided and different
        if email and u.get("email") != email:
            update_profile(user_id, {"email": email})
            u["email"] = email
        return u
    from datetime import datetime
    new_user = {
        "userId": user_id,
        "email": email or "",
        "name": "",
        "createdAt": datetime.utcnow().isoformat(),
    }
    user_repo.create_user(new_user)
    return new_user


def update_profile(user_id: str, updates: Dict[str, Any]) -> None:
    user_repo.update_user(user_id, updates)
