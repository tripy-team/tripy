import boto3
import uuid
from loyaltyRewardsLambda import get_loyalty_rewards_from_frontend


def index_handler(event, context):
    db_client = boto3.client("dynamodb")


# need to put information into the db
# should trigger lambda to see if credit card information is put in already


# information to collect
def get_info_from_signup():
    return {"user_uuid": uuid.uuid3()}


def put_signup_info_into_user_table(db_client):
    user_info = get_info_from_signup()
    response = db_client.put_item(
        TableName="user-info-table",
        Item={
            "firstName": {"S": user_info["first_name"]},
            "lastName": {"S": user_info["last_name"]},
            "email": {"S": user_info["email"]},
            "phone": {"S", user_info["phone"]},
            "birthdate": {"S": user_info["birthdate"]},
            "pastTrips": {"L": "past"},
        },
    )
    return response


def put_loyalty_rewards_into_dashboard(db_client):
    loyalty_rewards = get_loyalty_rewards_from_frontend()
    response = db_client.update_item(
        TableName="user-info-table", Key={"userUUID": {"S": "1"}}
    )
