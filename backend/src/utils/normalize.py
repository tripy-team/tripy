def normalize_program_name(raw: str) -> str:
    s = (raw or "").strip().lower()
    mapping = {
        "amex": "AMEX_MR",
        "membership rewards": "AMEX_MR",
        "chase": "CHASE_UR",
        "ultimate rewards": "CHASE_UR",
        "citi": "CITI_TYP",
        "thankyou": "CITI_TYP",
        "capital one": "C1",
        "venture": "C1",
    }
    return mapping.get(s, raw.strip().upper().replace(" ", "_"))
