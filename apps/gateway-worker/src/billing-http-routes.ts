import { authenticate, readRequiredSecret } from "./authenticate";
import {
  billingCancelRoute,
  billingCatalogRoute,
  billingCheckoutRoute,
  billingPortalRoute,
  billingReactivateRoute,
  billingStateRoute,
} from "./billing-routes";
import type { GatewayApp } from "./gateway-env";

const billingDependencies = { authenticate, readRequiredSecret };

export function registerBillingHttpRoutes(app: GatewayApp): void {
  app.get("/v1/billing/catalog", (c) => billingCatalogRoute(c, billingDependencies));
  app.post("/v1/billing/checkout", (c) => billingCheckoutRoute(c, billingDependencies));
  app.post("/v1/billing/portal", (c) => billingPortalRoute(c, billingDependencies));
  app.get("/v1/billing/state", (c) => billingStateRoute(c, billingDependencies));
  app.post("/v1/billing/cancel", (c) => billingCancelRoute(c, billingDependencies));
  app.post("/v1/billing/reactivate", (c) => billingReactivateRoute(c, billingDependencies));
}
