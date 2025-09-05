import boto3
import os
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from connections import get_trip_info_from_frontend


app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True}


@app.head("/", include_in_schema=False)
def root_head():
    return Response(status_code=204)


@app.post("/ingest")
async def ingest(req: Request):
    data = await req.json()
    print("payload:", data)
    print(get_trip_info_from_frontend(data))
    return {"status": "running"}


def start():
    load_dotenv()
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )


# a lot of lambdas
