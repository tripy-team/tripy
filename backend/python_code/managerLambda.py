import json
import requests
from dotenv import load_dotenv
import os
import boto3
from amadeus import Client, Location, ResponseError


def lambda_handler(index, context):
    pass


def test():
    auth_url = "https://test.api.amadeus.com/v1/security/oauth2/token"
    auth_payload = {
        "grant_type": "client_credentials",
        "client_id": os.getenv("AMADEUS_API_KEY"),
        "client_secret": os.getenv("AMADEUS_API_SECRET"),
    }

    auth_response = requests.post(auth_url, data=auth_payload)
    access_token = auth_response.json()
    print(access_token)


def tester():
    load_dotenv()
    amadeus = Client(
        client_id=os.getenv("AMADEUS_API_KEY"),
        client_secret=os.getenv("AMADEUS_API_SECRET"),
    )

    response = amadeus.reference_data.locations.get(
        keyword="LON", subType=Location.AIRPORT
    )
    print(response.result)


def lambda_handler(index, context):
    lambda_client = boto3.client("lambda")
    pass


def send_rewards_links_to_webscraping_lambda(client, links):
    for link in links:
        response = client.invoke(FunctionName="")
    pass


if __name__ == "__main__":
    tester()
