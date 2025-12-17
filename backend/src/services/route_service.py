from typing import List, Dict, Any


def generate_routes(destinations: List[Dict[str, Any]]) -> List[List[str]]:
    # MVP: simple permutations of destination IDs (filtered)
    ids = [d["destinationId"] for d in destinations if not d.get("excluded", False)]
    if len(ids) <= 1:
        return [ids]
    # MVP: return a few naive routes (not factorial blowup)
    routes = [
        ids,
        list(reversed(ids)),
    ]
    return routes
