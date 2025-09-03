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
    return {
        "edges": {
            "A": [
                ("SEA", "JFK", "DL456"),
                ("JFK", "CDG", "DL020"),
                ("CDG", "AMS", "KL030"),
            ]
        },
        "path": {"A": ["SEA", "JFK", "CDG", "AMS"]},
        "pay_mode": {
            "A": {
                ("CDG", "AMS", "KL030"): ("points", "A", ("MR", "KL"), 9000.0, 28.0),
                ("JFK", "CDG", "DL020"): ("points", "A", ("UR", "DL"), 24000.0, 70.0),
                ("SEA", "JFK", "DL456"): ("points", "A", ("UR", "DL"), 15500.0, 6.0),
            }
        },
        "status": "Optimal",
        "totals": {
            "airline_points": 48500.0,
            "cash": 104.0,
            "native_used": {"A": {}},
            "time": 14.100000000000001,
            "transfers": {
                "A": {
                    ("MR", "KL"): {
                        "blocks": 9,
                        "delivered_airline_points": 9000.0,
                        "source_points": 9000,
                    },
                    ("UR", "DL"): {
                        "blocks": 40,
                        "delivered_airline_points": 40000.0,
                        "source_points": 40000,
                    },
                }
            },
        },
    }


def start():
    load_dotenv()
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )


# a lot of lambdas
