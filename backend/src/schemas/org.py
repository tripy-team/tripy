from pydantic import BaseModel
from typing import Optional, Literal


class BrandingSettings(BaseModel):
    brand_name: Optional[str] = None
    brand_color: Optional[str] = "#1a56db"
    logo_url: Optional[str] = None


class CreateOrgRequest(BaseModel):
    name: str


class OrgResponse(BaseModel):
    org_id: str
    name: str
    owner_id: str
    plan: str
    trial_ends_at: Optional[str] = None
    branding: Optional[BrandingSettings] = None
    created_at: str


class UpdateBrandingRequest(BaseModel):
    brand_name: Optional[str] = None
    brand_color: Optional[str] = None
    logo_url: Optional[str] = None


class OrgMemberResponse(BaseModel):
    org_id: str
    user_id: str
    role: Literal["owner", "member"]
    created_at: str


class AddMemberRequest(BaseModel):
    email: str
    role: Literal["owner", "member"] = "member"
