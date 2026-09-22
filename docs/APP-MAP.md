# App map

Look here before exploring the app by clicking around. Add a row whenever a route
or a widget costs more than a couple of attempts to work out.

## Navigation index

| Page | How to open it | Page object |
| --- | --- | --- |
| Sign-in | `E2E_LOGIN_PATH` (default `/`) | `LoginPage.open` |
| Product list | `/inventory.html` after the saved session loads | `InventoryPage.open` |
| Cart | `/cart.html`, or the cart link in the header | `CartPage.open` |
| Checkout | Cart → Checkout, two steps then a confirmation | `CheckoutPage` |
| Todo sample | `TODO_APP_URL`, no sign-in | `TodoPage.open` |

## Helpers index

| Interaction | Where |
| --- | --- |
| Dialog closes, then a toast shows | `waitForModalDetachedThenToast` in `utils/interactions.ts` |
| Console errors and failed HTTP responses | `collectPageErrors` in `utils/interactions.ts` |
| Unique record names | `e2eName` / `e2eAlphaName` in `utils/test-data.ts` |
| Delete created data after a test | `CleanupRegistry` in `utils/cleanup.ts` |
| Sign in once and reuse the session | `tests/auth.setup.ts`, wired as the `setup` project |

## Quirks

- An `.or()` chain of two single-element locators resolves to two elements and
  trips strict mode. Put `.first()` on the composition.
- The demo shop keeps the cart in the saved session, so a test that adds items
  must clear them, or the next test starts with a full cart. That is what the
  cleanup registry in `tests/checkout/cart-checkout.spec.ts` demonstrates.
- Specs that exercise the sign-in form need `test.use({ storageState: { cookies: [], origins: [] } })`,
  otherwise the saved session skips straight past the form.

Add your own app's quirks here. The ones above are from the demo targets and can
be replaced.
