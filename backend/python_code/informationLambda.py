import boto3
import amadeus
import os


def lambda_handler(event, context):
    s3_client = boto3.client("s3")
    flight_s3_name = os.getenv("FLIGHT_INFORMATION_s3_NAME")
    flight_information = get_flight_information()
    flight_put_response = put_information(s3_client, flight_s3_name, flight_information)

    hotel_s3_name = os.getenv("HOTEL_INFORMATION_s3_NAME")
    hotel_information = get_hotel_information()
    hotel_put_response = put_information(s3_client, hotel_s3_name, hotel_information)


def put_information(s3_client, s3_name, information):
    """Puts information that is formatted in the put_object format in boto3 s3"""
    response = s3_client.put_object(TableName=s3_name, Item=information)
    return response


def get_flight_information(start_airport_code, end_airport_code):
    pass


def get_hotel_information():
    pass
