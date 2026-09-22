# App map

Look here before exploring the product by clicking around. Add a row when a route or a widget takes more than a couple of attempts.

## Navigation index

| Page | How to open it | Page object |
| --- | --- | --- |
| Sign-in | `E2E_LOGIN_PATH` (default `/`) | `LoginPage.open` |
| Home | `E2E_HOME_PATH` (default `/`) after the saved session loads | `HomePage.open` |
| Items (example) | `/items` | `ItemPage.gotoList` |

## Helpers index

| Interaction | Where |
| --- | --- |
| Dialog closes, then a toast shows | `waitForModalDetachedThenToast` in `utils/interactions.ts` |
| Console errors and failed HTTP responses | `collectPageErrors` in `utils/interactions.ts` |
| Unique record names | `e2eName` / `e2eAlphaName` in `utils/test-data.ts` |
| Delete created data after the test | `CleanupRegistry` in `utils/cleanup.ts` |

## Quirks

Add short notes here when the app does something easy to get wrong (slow widgets, duplicate DOM, redirects).
