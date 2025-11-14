# backend/cache_layer.py  (AWS-friendly cache: Redis -> DynamoDB -> live; no typing)
import os, json, time, zlib, base64
import boto3

try:
    import redis
except Exception:
    redis = None

REDIS_URL = os.getenv("REDIS_URL")  # e.g., redis://:pass@host:6379/0
REDIS_HOST = os.getenv("REDIS_HOST")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD")
REDIS_DB = int(os.getenv("REDIS_DB", "0"))

DDB_TABLE = os.getenv("CACHE_TABLE", "tripy-cache")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")


def _redis_client():
    if not redis:
        return None
    try:
        if REDIS_URL:
            return redis.Redis.from_url(
                REDIS_URL, socket_timeout=1.5, socket_connect_timeout=1.5
            )
        return redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            db=REDIS_DB,
            password=REDIS_PASSWORD or None,
            socket_timeout=1.5,
            socket_connect_timeout=1.5,
        )
    except Exception:
        return None


def _ddb_client():
    try:
        return boto3.resource("dynamodb", region_name=AWS_REGION).Table(DDB_TABLE)
    except Exception:
        return None


_r = _redis_client()
_t = _ddb_client()


def _pack(obj):
    data = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    comp = zlib.compress(data, 6)
    return base64.b64encode(comp).decode("ascii")


def _unpack(s):
    try:
        comp = base64.b64decode(s)
        data = zlib.decompress(comp)
        return json.loads(data.decode("utf-8"))
    except Exception:
        return None


def get_json(key):
    # 1) Redis
    if _r:
        try:
            v = _r.get(key)
            if v:
                return _unpack(v)
        except Exception:
            pass
    # 2) DynamoDB (with TTL attribute "ttl")
    if _t:
        try:
            res = _t.get_item(Key={"k": key})
            item = res.get("Item")
            if item and (not item.get("ttl") or int(item["ttl"]) > int(time.time())):
                val = _unpack(item.get("v", ""))
                if val and _r:
                    # backfill Redis with short TTL
                    try:
                        _r.setex(key, 900, _pack(val))
                    except Exception:
                        pass
                return val
        except Exception:
            pass
    return None


def set_json(key, obj, ttl_seconds):
    packed = _pack(obj)
    now = int(time.time())
    # Redis
    if _r:
        try:
            _r.setex(key, int(max(60, ttl_seconds)), packed)
        except Exception:
            pass
    # DynamoDB
    if _t:
        try:
            _t.put_item(Item={"k": key, "v": packed, "ttl": now + int(ttl_seconds)})
        except Exception:
            pass
