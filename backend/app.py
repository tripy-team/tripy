import boto3
import os
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from connections import get_trip_info_from_frontend


ALLOWED_ORIGINS = [
    "https://testing.d2p22adloz2lev.amplifyapp.com",
]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def health():
    return {"ok": True}


@app.post("/ingest")
async def ingest(req: Request):
    data = await req.json()
    print("payload:", data)
    return data


def start():
    load_dotenv()
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )


# a lot of lambdas
