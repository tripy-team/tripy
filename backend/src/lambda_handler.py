"""
Lambda handler for FastAPI application using Mangum.

This adapter allows the FastAPI app to run on AWS Lambda via API Gateway.
"""

import os
import logging
from mangum import Mangum
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import the FastAPI app
from .app import app

# Configure logging for Lambda
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Create Mangum handler
# text_mime_types: Add any additional text-based MIME types if needed
handler = Mangum(
    app,
    lifespan="off",  # FastAPI lifespan events not supported in Lambda
    text_mime_types=[
        "application/json",
        "application/vnd.api+json",
        "text/plain",
        "text/html",
    ],
)

# Lambda handler function
def lambda_handler(event, context):
    """
    AWS Lambda handler entry point.
    
    This function is called by API Gateway and forwards the request
    to the FastAPI application via Mangum.
    """
    try:
        logger.info(f"Lambda invoked: {event.get('requestContext', {}).get('http', {}).get('method', 'UNKNOWN')} {event.get('rawPath', 'UNKNOWN')}")
        
        # Process the request through Mangum
        response = handler(event, context)
        
        return response
    except Exception as e:
        logger.error(f"Lambda handler error: {str(e)}", exc_info=True)
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            },
            "body": '{"error": "Internal server error"}',
        }
