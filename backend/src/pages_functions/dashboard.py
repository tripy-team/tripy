import boto3
import os
from enum import Enum


class TravelStatus(Enum):
    UPCOMING = "upcoming"
    ONGOING = "ongoing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    PLANNING = "planning"


class TravelType(Enum):
    GROUP = "group"
    SOLO = "solo"


class FlightClass(Enum):
    ECONOMY = "economy"
    PREMIUM_ECONOMY = "premium_economy"
    BUSINESS = "business"
    FIRST = "first"


db_client = boto3.client("dynamodb")


def get_table_data_given_user_id(user_id: str):
    items = []
    last_evaluated_key = None

    while True:
        scan_kwargs = {
            "TableName": "tripy-trips",
            "ExpressionAttributeValues": {":user_id": {"S": user_id}},
            "FilterExpression": "user_id = :user_id",
        }

        if last_evaluated_key:
            scan_kwargs["ExclusiveStartKey"] = last_evaluated_key

        response = db_client.scan(**scan_kwargs)

        items.extend(response.get("Items", []))
        last_evaluated_key = response.get("LastEvaluatedKey")

        if not last_evaluated_key:
            break

    return items


def get_table_data_given_travel_status(travel_status: TravelStatus):
    items = []
    last_evaluated_key = None

    while True:
        scan_kwargs = {
            "TableName": "tripy-trips",
            "ExpressionAttributeValues": {":travel_status": {"S": travel_status.value}},
            "FilterExpression": "travel_status = :travel_status",
        }

        if last_evaluated_key:
            scan_kwargs["ExclusiveStartKey"] = last_evaluated_key

        response = db_client.scan(**scan_kwargs)

        items.extend(response.get("Items", []))
        last_evaluated_key = response.get("LastEvaluatedKey")

        if not last_evaluated_key:
            break

    return items


def sort_by_id(trips):
    return sorted(trips, key=lambda x: x["trip_id"]["S"])


def sort_by_date(trips):
    return sorted(trips, key=lambda x: x["start_date"]["S"])


def sort_by_name(trips):
    return sorted(trips, key=lambda x: x["trip_name"]["S"])


if __name__ == "__main__":
    print(get_table_data_given_user_id("eric"))
