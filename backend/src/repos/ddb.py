import boto3
from boto3.dynamodb.conditions import Key
from typing import Any, Dict, Optional, List

ddb = boto3.resource("dynamodb")


def table(name: str):
    return ddb.Table(name)


def get_item(t, key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    resp = t.get_item(Key=key)
    return resp.get("Item")


def put_item(t, item: Dict[str, Any]) -> None:
    t.put_item(Item=item)


def query_gsi(
    t, index_name: str, key_name: str, key_value: str
) -> List[Dict[str, Any]]:
    resp = t.query(
        IndexName=index_name, KeyConditionExpression=Key(key_name).eq(key_value)
    )
    return resp.get("Items", [])
