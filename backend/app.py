import boto3
import os
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from main import demo

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/ingest")
async def ingest(req: Request):
    # data = await req.json()
    # print("payload:", data)
    result = demo()  # or await demo()
    return JSONResponse(content=jsonable_encoder(result))
    return demo()


def start():
    load_dotenv()
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )


# a lot of lambdas
