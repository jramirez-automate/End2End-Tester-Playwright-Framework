# Coverage

Newest first. One row per ticket, added once its specs are green.

| Ticket | Area | Specs | Environments | Notes |
| --- | --- | --- | --- | --- |
| DEMO-002 | Todo list | `src/tests/todo/todo-list.spec.ts` | demo | Public TodoMVC sample. No sign-in. |
| DEMO-001 | Cart and checkout | `src/tests/checkout/cart-checkout.spec.ts` | demo | State-changing example with cleanup. |
| — | Sign in | `src/tests/auth/sign-in.spec.ts` | demo | `@smoke`. Valid and invalid paths. |
| — | Product list | `src/tests/inventory/product-list.spec.ts` | demo | `@smoke`. Listing and sorting. |

Replace these rows as you add your own features. The demo specs exist so the
suite is runnable and reviewable before it is pointed at anything private.
