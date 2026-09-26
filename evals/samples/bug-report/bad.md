Summary: checkout broken

CheckoutPage.continueToOverview() doesn't wait for validation — see src/pages/CheckoutPage.ts line 42, the locator getByRole("button", { name: "Continue" }) resolves too early. Probably a race in the form handler.

Tried it a few times, it's bad. Please fix ASAP, blocker!!
