import csv
import io
import requests

# Raw CSV (not the HTML page)
RAW_AIRPORTS_CSV = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv"

# Treat only these as "commercial"
_ALLOWED_TYPES = {"large_airport", "medium_airport", "small_airport"}


def load_commercial_iata_set_from_web(
    url: str = RAW_AIRPORTS_CSV, timeout: int = 20
) -> set:
    """
    Downloads the OurAirports CSV from GitHub and returns a set of IATA codes
    that are commercial (scheduled_service == 'yes' and type in allowed types).
    """
    r = requests.get(url, timeout=timeout)
    r.raise_for_status()

    commercial: set = set()
    text_stream = io.StringIO(r.text)
    reader = csv.DictReader(text_stream)

    for row in reader:
        iata = (row.get("iata_code") or "").strip().upper()
        if len(iata) != 3:  # skip blanks/non-IATA
            continue

        scheduled = (row.get("scheduled_service") or "").strip().lower() == "yes"
        typ = (row.get("type") or "").strip().lower()

        if scheduled and typ in _ALLOWED_TYPES:
            commercial.add(iata)

    return commercial


def is_commercial_airport(iata_code: str, commercial_set: set = None) -> bool:
    """
    Returns True if the IATA code is commercial using a preloaded set.
    If no set is passed, it will fetch the CSV once right now.
    """
    iata = (iata_code or "").strip().upper()
    if len(iata) != 3:
        return False
    if commercial_set is None:
        commercial_set = load_commercial_iata_set_from_web()
    return iata in commercial_set


# --- Example usage ---
if __name__ == "__main__":
    commercial_set = load_commercial_iata_set_from_web()  # fetch once
    print("SEA:", is_commercial_airport("SEA", commercial_set))  # True
    print(
        "PAE:", is_commercial_airport("PAE", commercial_set)
    )  # Likely False (seaplane base)
    print(
        "ITH:", is_commercial_airport("ITH", commercial_set)
    )  # Likely False (biz-jet)
