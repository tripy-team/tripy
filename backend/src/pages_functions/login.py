import boto3

db_client = boto3.client("dynamodb")
cognito_client = boto3.client("cognito-idp")

# To do:
# 1. before bringing in awardwallet, we need to allow users to sign up and simply put their credit card information
# 2. We have to decide if we should only use our domain or if google/apple is worth it
# 3. When we get funded, we will be able to support awardwallet integration
