import boto3
from dotenv import load_dotenv
import os
from phone_number_validator.validator import PhoneNumberValidator
from email_validator import validate_email, EmailNotValidError
import uuid


class UserPool:
    def __init__(self, cognito_client):
        response = cognito_client.create_user_pool(
            PoolName="tripy-users",
            Policies={
                "PasswordPolicy": {
                    "MinimumLength": 12,
                    "RequireUpperCase": True,
                    "RequireLowercase": True,
                    "RequireNumbers": True,
                    "RequireSymbols": True,
                    "PasswordHistorySize": 8,
                },
                "SignInPolicy": {"AllowedFirstAuthFactors": ["PASSWORD"]},
            },
            DeletionProtection="ACTIVE",
            LambdaConfig={},
        )
        self.response = response

    def get_user_pool_id(self):
        return self.response["UserPool"]["Id"]


class UserPoolClient:
    def __init__(self, cognito_client, userpool_id):
        response = cognito_client.create_user_pool_client(
            UserPoolId=userpool_id, ClientName="tripy_users_client"
        )
        self.response = response

    def get_client_id(self):
        return self.response["UserPoolClient"]["ClientId"]


class CognitoSDK:
    def __init__(
        self,
        cognito_client,
        user_pool_id,
        client_id,
        first_name,
        last_name,
        email,
        phone,
        password,
        birthdate,
        gender,
    ):
        self.cognito_client = cognito_client
        self.user_pool_id = user_pool_id
        self.client_id = client_id
        self.first_name = first_name
        self.last_name = last_name
        self.email = email
        self.phone = phone
        self.password = password
        self.birthdate = birthdate
        self.gender = gender
        self.referral_code = uuid.uuid4()

    def validate_user_info(self, check_deliverability=False):
        load_dotenv()
        user_email = self.email
        phone_number = self.phone
        try:
            email_info = validate_email(user_email, check_deliverability)
            email = email_info.normalized
        except EmailNotValidError as e:
            assert f"Email {user_email} is not valid"
        phone_validator = PhoneNumberValidator(api_key=os.getenv("NUMLOOKUP_API_KEY"))
        assert (
            phone_validator.validate(phone_number) == True
        ), f"{phone_number} is not valid"
        return {"success": True, "response": {"email": email, "phone": phone_number}}

    def register_user(self):
        assert self.validate_user_info(True)["success"] == False
        response = self.cognito_client.sign_up(
            ClientId=self.client_id,
            Username=self.email,
            Password=self.password,
            UserAttributes=[
                {"Name": "first_name", "Value": self.first_name},
                {"Name": "last_name", "Value": self.last_name},
                {"Name": "phone", "Value": self.phone},
                {"Name": "birthdate", "Value": self.birthdate},
                {"Name": "gender", "Value": self.gender},
            ],
        )
        # create database and include sync syncing functionality
        return {"success": True, "response": response}

    def confirm_registration(self, confirmation_code):
        response = self.cognito_client.confirm_sign_up(
            ClientId=self.client_id,
            Username=self.email,
            ConfirmationCode=confirmation_code,
        )
        return {"success": True, "response": response}

    def login(self, username, password):
        pass


if __name__ == "__main__":
    load_dotenv()
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )
    cognito_client = session.client("cognito-idp")
    userpool = UserPool(cognito_client)
    userpool_id = userpool.get_user_pool_id()
    userpool_client = UserPoolClient(cognito_client, userpool_id)
    cognito = CognitoSDK(cognito_client, userpool_id)
