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
| Posts API (demo) | `API_BASE_URL` + `posts`, `posts/<id>` — JSONPlaceholder fakes writes | `api` fixture |

## Helpers index

| Interaction | Where |
| --- | --- |
| Dialog closes, then a toast shows | `waitForModalDetachedThenToast` in `src/utils/interactions.ts` |
| Console errors and failed HTTP responses | `collectPageErrors` in `src/utils/interactions.ts` |
| Unique record names | `e2eName` / `e2eAlphaName` in `src/utils/test-data.ts` |
| Delete created data after a test | `CleanupRegistry` in `src/utils/cleanup.ts` (`<APIRequestContext>` for API specs) |
| Sign in once and reuse the session | `src/tests/auth.setup.ts`, wired as the `setup` project |
| Call the API with this environment's auth | `api` fixture (`anonApi` for no credentials) in `src/fixtures.ts`, built by `apiContext` in `src/utils/api.ts` |
| Attach an API response as the case's proof | `readBody` in `src/utils/api.ts` |
| Status assertion that shows URL and body on failure | `describeResponse` in `src/utils/api.ts` |
| Schema-check a response, naming the broken field | `parseWith` (zod) in `src/utils/api.ts` |

## Quirks

- An `.or()` chain of two single-element locators resolves to two elements and
  trips strict mode. Put `.first()` on the composition.
- The demo shop keeps the cart in the saved session, so a test that adds items
  must clear them, or the next test starts with a full cart. That is what the
  cleanup registry in `src/tests/checkout/cart-checkout.spec.ts` demonstrates.
- Specs that exercise the sign-in form need `test.use({ storageState: { cookies: [], origins: [] } })`,
  otherwise the saved session skips straight past the form.

Add your own app's quirks here. The ones above are from the demo targets and can
be replaced.
