import boto3


def index_handler(event, context):
    pass


def get_loyalty_rewards_from_frontend():
    return [
        {
            "account": "string",
            "account_type": "hotel, credit card, airline",
            "api_key": "api_key_for_loyalty_point",
        }
    ]
