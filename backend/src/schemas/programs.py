"""
Canonical Program IDs (Controlled Vocabulary)

Core to the arbitrage engine. These are the canonical program identifiers 
used across frontend, backend, and optimizer. Never use user-entered labels.
"""
from enum import Enum


class PointsProgram(str, Enum):
    """
    Canonical program identifiers for points arbitrage.
    These IDs are used consistently across:
    - Backend API requests/responses
    - Frontend state
    - Optimizer calculations
    - DynamoDB storage
    """
    
    # Credit Card Programs (transferable currencies)
    CHASE_UR = "chase_ur"           # Chase Ultimate Rewards
    AMEX_MR = "amex_mr"             # Amex Membership Rewards
    CITI_TYP = "citi_typ"           # Citi ThankYou Points
    CAPITAL_ONE = "capital_one"     # Capital One Miles
    BILT = "bilt"                   # Bilt Rewards
    
    # Airline Programs
    UNITED = "united"               # United MileagePlus
    AMERICAN = "american"           # AAdvantage
    DELTA = "delta"                 # SkyMiles
    SOUTHWEST = "southwest"         # Rapid Rewards
    JETBLUE = "jetblue"             # TrueBlue
    ALASKA = "alaska"               # Mileage Plan
    BRITISH_AIRWAYS = "british_airways"  # Avios
    VIRGIN_ATLANTIC = "virgin_atlantic"  # Flying Club
    AIR_FRANCE_KLM = "air_france_klm"    # Flying Blue
    SINGAPORE = "singapore"         # KrisFlyer
    ANA = "ana"                     # ANA Mileage Club
    
    # Hotel Programs
    MARRIOTT = "marriott"           # Marriott Bonvoy
    HILTON = "hilton"               # Hilton Honors
    HYATT = "hyatt"                 # World of Hyatt
    IHG = "ihg"                     # IHG One Rewards
