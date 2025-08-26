import boto3
import os
from dotenv import load_dotenv
from enum import Enum
from boto3.dynamodb.conditions import Key, Attr


class TableNames(Enum):
    trips_table_name = "trips_table"


def create_trips_table(email, session):
    db_client = session.client("dynamodb")
    response = db_client.create_table(
        TableName="".join(email, "_", TableNames.trips_table_name.value),
        AttributeDefinitions=[
            {"AttributeName": "trip_uuid", "AttributeType": "S"},
            {"AttributeName": "start_date", "AttributeType": "S"},
            {"AttributeName": "end_date", "AttributeType": "S"},
            {"AttributeName": "destinations", "AttributeType": "S"},
            {"AttributeName": "flights", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "trip_uuid", "AttributeType": "HASH"},
        ],
        DeletionProtectionEnabled=True,
    )
    return response


# # make sure to include encrypted api keys
# def put_user_into_global_user_info_table(
#     email, phone, first_name, last_name, birthdate, gender, referral_code
# ):
#     db_client = session.client("dynamodb")
#     try:
#         query_table_existing_user_responses = db_client.query(
#             TableName=TableNames.global_user_table_name.value,
#             KeyConditionExpression=Key("email").eq(email),
#             FilerExpression=Attr("phone").eq(phone),
#         )
#         assert (
#             "User already exists. Make sure to use a different email and phone number"
#         )
#     except db_client.exceptions.ResourceNotFoundException as e:
#         put_user_into_table_respone = db_client.put_item(
#             TableName=TableNames.global_user_table_name.value,
#             Item={
#                 "email": {"S": email},
#                 "phone": {"S": phone},
#                 "first_name": {"S": first_name},
#                 "last_name": {"S": last_name},
#                 "birthdate": {"S": birthdate},
#                 "gender": {"S": gender},
#                 "referral_code": {"S": referral_code},
#             },
#         )
#         return put_user_into_table_respone
def put_trip_into_trips_table(session):
    db_client = session.client("dynamodb")
    try:
        query_table_existing_user_responses = db_client.query(
            TableName=TableNames.global_user_table_name.value,
            KeyConditionExpression=Key("email").eq(email),
            FilerExpression=Attr("phone").eq(phone),
        )
        assert (
            "User already exists. Make sure to use a different email and phone number"
        )
    except Exception as e:
        put_user_into_table_respone = db_client.put_item(
            TableName=TableNames.global_user_table_name.value,
            Item={
                "email": {"S": email},
                "phone": {"S": phone},
                "first_name": {"S": first_name},
                "last_name": {"S": last_name},
                "birthdate": {"S": birthdate},
                "gender": {"S": gender},
                "referral_code": {"S": referral_code},
            },
        )
        return put_user_into_table_respone
