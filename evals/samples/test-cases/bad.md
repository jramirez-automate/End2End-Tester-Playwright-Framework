| tc  | Name              | Steps                                                                                          | Expected result                                  |
|-----|-------------------|------------------------------------------------------------------------------------------------|--------------------------------------------------|
| TC1 | Checkout works    | await inventory.addToCart(product); click getByRole("button", { name: "Checkout" }); fill form | Order confirmed, cart empty, badge hidden, URL /checkout-complete.html |
| TC5 | Test the form     | Open the app and test the checkout form in src/tests/checkout/checkout.spec.ts                  | Works                                            |
| TC6 | Long names        | Type 300 characters into first name                                                            | Shows "Name must be under 50 characters"         |
