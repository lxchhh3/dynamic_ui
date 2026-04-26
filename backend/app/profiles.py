"""Mock per-user profile data.

For the demo, we don't have a real HR/identity store. The profile here is
the blob the LLM is allowed to pre-fill RequestForm fields from. Keys must
match `RequestSheet.tsx` field keys.
"""

from __future__ import annotations

MOCK_PROFILES: dict[str, dict[str, str]] = {
    "IReallyRock": {
        "name": "Kevin Lee",
        "employeeId": "E20471",
        "department": "Operations",
        "contact": "kevin.lee@secretseasoning.top",
    },
    "morgan": {
        "name": "Morgan Yates",
        "employeeId": "E20188",
        "department": "R&D",
        "contact": "morgan.yates@secretseasoning.top",
    },
    "priya": {
        "name": "Priya Iyer",
        "employeeId": "E20399",
        "department": "Engineering",
        "contact": "priya.iyer@secretseasoning.top",
    },
    "dex": {
        "name": "Dex Carter",
        "employeeId": "E20056",
        "department": "Facilities",
        "contact": "dex.carter@secretseasoning.top",
    },
    "sam": {
        "name": "Sam Park",
        "employeeId": "E20712",
        "department": "Executive",
        "contact": "sam.park@secretseasoning.top",
    },
}

# Form field keys that can potentially be pre-filled from MOCK_PROFILES.
# `dateTime` is excluded — frontend defaults it to "now".
# `visitor` and `intention` are user judgment, never autofillable.
PROFILE_FIELDS: list[str] = ["name", "employeeId", "department", "contact"]
