import boto3
from dotenv import load_dotenv
import os
import yodlee


def index_handler(event, context):
    pass


def create_loyalty_points_db():
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )
    db_client = session.client("dynamodb")
    response = db_client.create_table()  # insert


# use this for creating a table for loyalty point api storage
def get_all_loyalty_point_api_keys():
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )
    kms_client = session.client("kms")
    kms_key_id = kms_client.create_key()["KeyMetadata"]["KeyId"]


# put database here and be able to access it
