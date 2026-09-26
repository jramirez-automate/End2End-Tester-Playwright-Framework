Environment:
URL: https://dev.example.com/checkout-step-one.html
Browser ver: Chromium 140 (headless)
Build: 2026.10.4   Env: dev   Account: standard_user

Summary:
Checkout continues to the order overview when the postal code is empty

Steps to reproduce:
1. Sign in as standard_user
2. Add "Sauce Labs Backpack" to the cart and open the cart
3. Click Checkout
4. Enter first name "Ada" and last name "Lovelace", leave Postal Code empty
5. Click Continue

Expected result:
"Error: Postal Code is required" is shown and checkout stays on the details page (PROJ-103 AC2, TC-002).

Actual result:
The order overview page opens with no error message.

Frequency: every time
Severity: High
Priority: High (suggested)
Found by: TC-002 in the PROJ-103 evidence run
Evidence: checkout-refused-without-postcode-dev-FAILED.png, .webm attached
