# everything about getting things from the frontend
# calculate all cominations of dates with each being a different combination of dates
def get_trip_info_from_frontend(data):
    return data
    return {
        "traveler": {"ezhong0211@gmail.com": "eric"},
        "cities": ["SEA", "JFK", "CDG", "AMS"],
        "start": "SEA",
        "end": "AMS",
        "start_date": "start_date",
        "dates_departing": ["dates", "date"],
        "end_date": "end_date",
        "num_people": {"adults": 1, "children": 0},
        "loyalty_points": {
            "credit_card": {"amex": 100},
            "hotel": {"hilton": 100},
            "airline": {"delta": 100},
        },
    }


# get this from awardtool api
def get_award_points_dict(airlines, edges_dict):
    award_points = {}
    for airline in airlines:
        for edge in edges_dict:
            _, _, flight = edge
            if airline in flight:
                pass
    pass


def get_award_points_cost(edge):
    flights_points_dict = {}
    for edge in edges_dict:
        flights_points_dict[edge] = 1000
    return flights_points_dict
