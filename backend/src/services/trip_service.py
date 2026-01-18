import uuid
from typing import Dict, Any, Optional, List
from src.repos import trip_repo, trip_member_repo


def create_trip(
    user_id: str, title: str, start_date: str, end_date: str
) -> Dict[str, Any]:
    trip_id = str(uuid.uuid4())
    invite_code = str(uuid.uuid4())[:8]

    trip = {
        "tripId": trip_id,
        "createdBy": user_id,
        "title": title,
        "startDate": start_date,
        "endDate": end_date,
        "inviteCode": invite_code,
        "status": "active",
    }
    trip_repo.put_trip(trip)

    trip_member_repo.add_member(
        {
            "tripId": trip_id,
            "userId": user_id,
            "role": "owner",
            "status": "active",
        }
    )

    return trip


def get_trip(trip_id: str) -> Optional[Dict[str, Any]]:
    return trip_repo.get_trip(trip_id)


def get_trip_by_invite(invite_code: str) -> Optional[Dict[str, Any]]:
    return trip_repo.get_trip_by_invite_code(invite_code)


def list_trips_for_user(user_id: str) -> List[Dict[str, Any]]:
    """List all trips for a user (both owned and joined)"""
    from .destination_service import list_destinations
    from .trip_member_service import list_members
    
    # Get trip memberships
    memberships = trip_member_repo.list_trips_for_user(user_id)
    
    # Get trip details for each membership
    trips = []
    for membership in memberships:
        trip_id = membership.get("tripId")
        if trip_id:
            trip = trip_repo.get_trip(trip_id)
            if trip:
                # Add membership info to trip
                trip["role"] = membership.get("role", "member")
                trip["memberStatus"] = membership.get("status", "active")
                
                # Get member count
                members = list_members(trip_id)
                trip["memberCount"] = len(members) if members else 1
                
                # Get destinations (first destination name for display)
                destinations = list_destinations(trip_id)
                if destinations:
                    trip["destinations"] = [d.get("name") for d in destinations]
                    trip["firstDestination"] = destinations[0].get("name", "")
                else:
                    trip["destinations"] = []
                    trip["firstDestination"] = ""
                
                trips.append(trip)
    
    # Sort by startDate descending (most recent first)
    trips.sort(key=lambda x: x.get("startDate", ""), reverse=True)
    return trips
