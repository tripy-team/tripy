import os, json, time, secrets
import boto3

dynamodb = boto3.resource("dynamodb")
INVITES_TABLE = os.environ["INVITES_TABLE"]
FRONTEND_URL = os.environ["FRONTEND_URL"]  # https://tripy.app


def handler(event, context):
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    user_id = claims.get("sub")
    if not user_id:
        return _resp(401, {"error": "Unauthorized"})

    trip_id = event.get("pathParameters", {}).get("tripId")
    if not trip_id:
        return _resp(400, {"error": "tripId required"})

    token = secrets.token_urlsafe(16)  # secure, unguessable
    now = int(time.time())
    expires_at = now + 60 * 60 * 24  # 24 hours

    table = dynamodb.Table(INVITES_TABLE)
    table.put_item(
        Item={
            "pk": f"INVITE#{token}",
            "tripId": trip_id,
            "createdBy": user_id,
            "createdAt": now,
            "expiresAt": expires_at,
            "used": False,
        }
    )

    invite_url = f"{FRONTEND_URL}/invite/{token}"

    return _resp(
        200,
        {
            "inviteUrl": invite_url,
            "expiresAt": expires_at,
        },
    )


def _resp(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
