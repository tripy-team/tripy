# backend/cache_ddb.py
import os, json, time, hashlib
from typing import Optional, Any, Dict
import boto3
from botocore.exceptions import (
    ClientError,
    NoCredentialsError,
    EndpointConnectionError,
    ProfileNotFound,
)
from dotenv import load_dotenv

load_dotenv()
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
DDB_CACHE_TABLE = os.getenv("DDB_CACHE_TABLE", "TripyCache")
DDB_ENDPOINT = os.getenv("DDB_ENDPOINT")
DDB_AUTO_CREATE = os.getenv("DDB_AUTO_CREATE", "0").lower() in ("1", "true")


def _now() -> int:
    return int(time.time())


def _hashable(obj: Any) -> str:
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, default=str).encode()
    ).hexdigest()


from botocore.exceptions import ProfileNotFound


def _boto3_session():
    region = os.getenv("AWS_REGION", "us-east-1")

    # 1) Prefer explicit keys from .env if present
    ak = os.getenv("AWS_ACCESS_KEY_ID")
    sk = os.getenv("AWS_SECRET_ACCESS_KEY")
    token = os.getenv("AWS_SESSION_TOKEN")
    if ak and sk:
        return boto3.Session(
            aws_access_key_id=ak,
            aws_secret_access_key=sk,
            aws_session_token=token,
            region_name=region,
        )

    # 2) Then try a named profile if provided and valid
    profile = os.getenv("AWS_PROFILE")
    if profile:
        try:
            return boto3.Session(profile_name=profile, region_name=region)
        except ProfileNotFound:
            print(
                f"[cache] AWS_PROFILE '{profile}' not found; falling back to default chain"
            )

    # 3) Finally, default credential chain / default profile
    return boto3.Session(region_name=region)


def _maybe_create_table(session, table_name: str, endpoint: Optional[str]):
    try:
        ddb = (
            session.resource("dynamodb", region_name=AWS_REGION, endpoint_url=endpoint)
            if endpoint
            else session.resource("dynamodb", region_name=AWS_REGION)
        )
        table = ddb.create_table(
            TableName=table_name,
            KeySchema=[{"AttributeName": "cache_key", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "cache_key", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        table.wait_until_exists()
        try:
            client = (
                session.client(
                    "dynamodb", region_name=AWS_REGION, endpoint_url=endpoint
                )
                if endpoint
                else session.client("dynamodb", region_name=AWS_REGION)
            )
            client.update_time_to_live(
                TableName=table_name,
                TimeToLiveSpecification={
                    "Enabled": True,
                    "AttributeName": "expires_at",
                },
            )
        except ClientError:
            pass
        return table
    except ClientError:
        return None


def _get_ddb_table_or_none():
    try:
        session = _boto3_session()
        ddb = (
            session.resource(
                "dynamodb", region_name=AWS_REGION, endpoint_url=DDB_ENDPOINT
            )
            if DDB_ENDPOINT
            else session.resource("dynamodb", region_name=AWS_REGION)
        )
        table = ddb.Table(DDB_CACHE_TABLE)
        table.load()
        return table
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        msg = e.response.get("Error", {}).get("Message", "")
        print(f"[cache] DDB ClientError: {code} - {msg}")
        if code == "ResourceNotFoundException" and DDB_AUTO_CREATE:
            created = _maybe_create_table(session, DDB_CACHE_TABLE, DDB_ENDPOINT)
            if created:
                return created
        return None
    except (NoCredentialsError, EndpointConnectionError) as e:
        print(f"[cache] DDB access problem: {e}")
        return None


class _InMemoryKV:
    def __init__(self):
        self.store: Dict[str, Dict[str, Any]] = {}

    def get(self, key: str):
        item = self.store.get(key)
        if not item:
            return None
        if item.get("expires_at", 0) and item["expires_at"] < _now():
            self.store.pop(key, None)
            return None
        try:
            return json.loads(item["value"])
        except Exception:
            return None

    def put(self, key: str, value: dict, ttl: int):
        self.store[key] = {
            "value": json.dumps(value, default=str),
            "expires_at": _now() + ttl,
            "updated_at": _now(),
        }


class DDBCache:
    """DynamoDB KV with lazy init + in-memory fallback."""

    def __init__(self, ttl_seconds: int = 6 * 60 * 60):
        self.ttl = ttl_seconds
        self._table = None
        self._mem = _InMemoryKV()
        self._initialized = False

    def _ensure(self):
        if self._initialized:
            return
        self._table = _get_ddb_table_or_none()
        if not self._table:
            print("[cache] Using IN-MEMORY fallback (no DynamoDB available)")
        self._initialized = True

    def get(self, key: str):
        self._ensure()
        if self._table:
            try:
                res = self._table.get_item(Key={"cache_key": key}, ConsistentRead=False)
                item = res.get("Item")
                if not item:
                    return None
                if int(item.get("expires_at", 0)) < _now():
                    return None
                return json.loads(item["value"])
            except (ClientError, ValueError):
                pass
        return self._mem.get(key)

    def put(self, key: str, value: dict, ttl_seconds: Optional[int] = None):
        self._ensure()
        exp = _now() + (ttl_seconds or self.ttl)
        if self._table:
            try:
                self._table.put_item(
                    Item={
                        "cache_key": key,
                        "value": json.dumps(value, default=str),
                        "expires_at": exp,
                        "updated_at": _now(),
                    }
                )
                return
            except ClientError:
                pass
        self._mem.put(key, value, (ttl_seconds or self.ttl))


class SerpDDBCache(DDBCache):
    def full_key(self, start, end, date_str, filters):
        return f"FULL:{start}:{end}:{date_str}:{_hashable(filters or {})}"

    def leg_key(self, tag, dep, arr, date_str, bucket, filters):
        return f"LEG:{tag}:{dep}:{arr}:{date_str}:{bucket or 'any'}:{_hashable(filters or {})}"

    def get_full(self, start, end, date_str, filters):
        return self.get(self.full_key(start, end, date_str, filters))

    def put_full(self, start, end, date_str, filters, res, ttl_seconds=None):
        self.put(self.full_key(start, end, date_str, filters), res, ttl_seconds)

    def get_leg(self, dep, arr, date_str, bucket, filters, coarse):
        return self.get(
            self.leg_key(
                "COARSE" if coarse else "PREC", dep, arr, date_str, bucket, filters
            )
        )

    def put_leg(
        self, dep, arr, date_str, bucket, filters, res, coarse, ttl_seconds=None
    ):
        self.put(
            self.leg_key(
                "COARSE" if coarse else "PREC", dep, arr, date_str, bucket, filters
            ),
            res,
            ttl_seconds,
        )


class TPGValCache(DDBCache):
    def get_vals(self):
        return self.get("TPG_VALS")

    def put_vals(self, vals, ttl_seconds=None):
        self.put("TPG_VALS", vals, ttl_seconds)


# lazy singletons
_SERP_CACHE = None
_TPG_CACHE = None


def get_serp_cache() -> SerpDDBCache:
    global _SERP_CACHE
    if _SERP_CACHE is None:
        _SERP_CACHE = SerpDDBCache()
    return _SERP_CACHE


def get_tpg_cache() -> TPGValCache:
    global _TPG_CACHE
    if _TPG_CACHE is None:
        _TPG_CACHE = TPGValCache()
    return _TPG_CACHE


def ensure_cache_table_exists():
    sess = _boto3_session()
    ddb = (
        sess.resource("dynamodb", region_name=AWS_REGION, endpoint_url=DDB_ENDPOINT)
        if DDB_ENDPOINT
        else sess.resource("dynamodb", region_name=AWS_REGION)
    )
    client = (
        sess.client("dynamodb", region_name=AWS_REGION, endpoint_url=DDB_ENDPOINT)
        if DDB_ENDPOINT
        else sess.client("dynamodb", region_name=AWS_REGION)
    )
    try:
        tbl = ddb.Table(DDB_CACHE_TABLE)
        tbl.load()
        print(f"[cache] Table '{DDB_CACHE_TABLE}' exists.")
        return
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "ResourceNotFoundException":
            raise
    print(f"[cache] Creating table '{DDB_CACHE_TABLE}'...")
    tbl = ddb.create_table(
        TableName=DDB_CACHE_TABLE,
        KeySchema=[{"AttributeName": "cache_key", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "cache_key", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    tbl.wait_until_exists()
    try:
        client.update_time_to_live(
            TableName=DDB_CACHE_TABLE,
            TimeToLiveSpecification={"Enabled": True, "AttributeName": "expires_at"},
        )
    except ClientError:
        pass
    print(f"[cache] Table '{DDB_CACHE_TABLE}' created.")
