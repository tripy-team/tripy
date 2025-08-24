import boto3


class User:
    def __init__(self, first_name, last_name, email, phone, birthdate):
        self.db_client = boto3.client("dynamodb")
        self.first_name = first_name
        self.last_name = last_name
        self.email = email
        self.phone = phone
        self.birthdate = birthdate
        self.trips = self.db_client.create_table(AttributeDefinitions=[{}])
        # self.trips = self.db_client.create_table(
        #     AttributeDefintions=[
        #         {"first_name": self.first_name, "AttributeType": "S"},
        #         {"last_name": self.last_name, "AttributeType": "S"},
        #         {"email": self.email, "AttributeType": "S"},
        #         {"phone": self.phone, "AttributeType": "S"},
        #         {"birthdate": self.birthdate, "AttributeType": "S"},
        #     ]
        # )
