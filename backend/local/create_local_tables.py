"""
Create all Tripy DynamoDB tables in a LOCAL DynamoDB (DynamoDB Local / moto).

Key schemas + GSIs mirror infra/lib/dbStack.ts (and the two tables created
outside CDK: tripy-destinations, tripy-destination-votes). All tables are
PAY_PER_REQUEST in prod; DynamoDB Local ignores billing mode, so we pass a
nominal ProvisionedThroughput.

Usage:
    # 1. start local dynamodb on :8001 (see local/run_dynamodb_local.sh)
    # 2. run this (idempotent — skips tables that already exist):
    DYNAMODB_ENDPOINT_URL=http://localhost:8001 python local/create_local_tables.py
"""

import os
import boto3
from botocore.exceptions import ClientError

ENDPOINT = os.environ.get("DYNAMODB_ENDPOINT_URL", "http://localhost:8001")
REGION = os.environ.get("AWS_REGION", "us-east-1")

ddb = boto3.client(
    "dynamodb",
    endpoint_url=ENDPOINT,
    region_name=REGION,
    aws_access_key_id="local",
    aws_secret_access_key="local",
)

S = "S"  # string attribute type — every key in this app is a string


def gsi(name, pk, sk=None):
    """Build a GSI definition with ALL projection (matches the CDK stack)."""
    schema = [{"AttributeName": pk, "KeyType": "HASH"}]
    if sk:
        schema.append({"AttributeName": sk, "KeyType": "RANGE"})
    return {
        "IndexName": name,
        "KeySchema": schema,
        "Projection": {"ProjectionType": "ALL"},
    }


# (table_name, pk, sk_or_None, [gsi, ...])
TABLES = [
    ("tripy-users", "userId", None, [gsi("email-index", "email")]),
    ("tripy-trips", "tripId", None, [
        gsi("inviteCode-index", "inviteCode"),
        gsi("orgId-index", "orgId"),
    ]),
    ("tripy-trip-members", "tripId", "userId", [gsi("userId-index", "userId")]),
    ("tripy-points", "tripId", "userProgram", []),
    ("tripy-destinations", "tripId", "destinationId", []),
    ("tripy-destination-votes", "tripId", "voteId", []),
    ("tripy-itinerary", "tripId", "itemId", []),
    ("tripy-invites", "inviteCode", None, []),
    ("tripy-monitoring-subscriptions", "subscription_id", None, [
        gsi("trip-email-index", "trip_email_key", "created_at"),
        gsi("trip-index", "trip_id", "created_at"),
        gsi("user-index", "user_id", "created_at"),
        gsi("due-index", "state_bucket", "next_check_at"),
    ]),
    ("tripy-monitoring-baselines", "baseline_id", None, []),
    ("tripy-monitoring-updates", "update_id", None, [
        gsi("sub-index", "subscription_id", "detected_at"),
    ]),
    ("tripy-rate-limit-counters", "pk", None, []),
    ("tripy-organizations", "orgId", None, []),
    ("tripy-org-members", "orgId", "userId", [gsi("userId-index", "userId")]),
    ("tripy-clients", "orgId", "clientId", []),
    ("tripy-client-points", "orgClientId", "program", []),
    ("tripy-proposals", "orgId", "proposalId", []),
    ("tripy-preference-signals", "orgId", "timestampSignalId", []),
    ("tripy-group-planning", "groupTripId", "sk", [
        gsi("ownerUserId-index", "ownerUserId"),
    ]),
    ("tripy-city-images", "city", None, []),
]


def attr_defs(pk, sk, gsis):
    """Collect every attribute referenced by the table key or any GSI key."""
    names = {pk}
    if sk:
        names.add(sk)
    for g in gsis:
        for k in g["KeySchema"]:
            names.add(k["AttributeName"])
    return [{"AttributeName": n, "AttributeType": S} for n in sorted(names)]


def create(table_name, pk, sk, gsis):
    key_schema = [{"AttributeName": pk, "KeyType": "HASH"}]
    if sk:
        key_schema.append({"AttributeName": sk, "KeyType": "RANGE"})

    params = {
        "TableName": table_name,
        "KeySchema": key_schema,
        "AttributeDefinitions": attr_defs(pk, sk, gsis),
        "BillingMode": "PAY_PER_REQUEST",
    }
    if gsis:
        params["GlobalSecondaryIndexes"] = gsis

    try:
        ddb.create_table(**params)
        print(f"  created  {table_name}")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceInUseException":
            print(f"  exists   {table_name} (skipped)")
        else:
            raise


def main():
    print(f"Creating tables on {ENDPOINT} ...")
    for table_name, pk, sk, gsis in TABLES:
        create(table_name, pk, sk, gsis)
    print(f"Done. {len(TABLES)} tables ensured.")


if __name__ == "__main__":
    main()
