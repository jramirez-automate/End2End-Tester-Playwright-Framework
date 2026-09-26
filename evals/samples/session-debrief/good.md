Covered:
Mission "checkout with back button and a second tab", dev (build 2026.10.4), 60 minutes. Idea lists: interruptions, follow the money.

Found:
- PROJ-120 — clicking Finish in two tabs confirms the order twice
- Question for the PO: should a stale tab be allowed to resubmit an order?

Blocked by:
No test card for declined payments on dev, so decline handling was not tried.

Still open:
- Explore checkout using a session that expires on the overview page to find lost carts
- Explore payment declines once a declining test card is available on dev

Risk call:
Ship with known issues — the double confirmation only happens with two tabs open and PROJ-120 is raised as High.
