from ..utils.errors import response


def handler(event, context):
    return response(200, {"ok": True})
