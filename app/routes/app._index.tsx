<<<<<<< HEAD
export default function Index() {
  return (
    <s-page heading="Shopify Learning App">
      <s-section>
        <s-heading>Home</s-heading>
        <s-paragraph>Welcome to your learning app.</s-paragraph>
        <s-link href="/app/products">View first 5 products</s-link>
=======
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getAutoFulfillmentRoutingSettings,
  upsertAutoFulfillmentRoutingSettings,
} from "../services/auto-routing.server";

type LocationOption = { id: string; name: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const shopResponse = await admin.graphql(`query { shop { myshopifyDomain } }`);
  const shopJson = await shopResponse.json();
  const shopDomain = shopJson?.data?.shop?.myshopifyDomain as string;

  let locations: LocationOption[] = [];
  let locationsError: string | undefined;

  try {
    const response = await admin.graphql(`query { locations(first: 250) { edges { node { id name } } } }`);
    const json = await response.json();
    if (json?.errors?.length) throw new Error(json.errors[0]?.message || "Unable to load locations.");
    locations = (json?.data?.locations?.edges ?? []).map((edge: any) => ({ id: edge.node.id, name: edge.node.name }));
  } catch (error) {
    locationsError = error instanceof Error ? error.message : "Unable to load locations.";
  }

  const settings = await getAutoFulfillmentRoutingSettings(shopDomain);
  return { locations, settings, locationsError };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const shopResponse = await admin.graphql(`query { shop { myshopifyDomain } }`);
  const shopJson = await shopResponse.json();
  const shopDomain = shopJson?.data?.shop?.myshopifyDomain as string;
  const formData = await request.formData();

  await upsertAutoFulfillmentRoutingSettings(
    shopDomain,
    formData.get("enabled") === "true" || formData.get("enabled") === "on",
    String(formData.get("fallbackLocationId") || "") || null,
    [],
  );

  return { success: true };
};

export default function Index() {
  const { locations, settings, locationsError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Auto Fulfillment Routing">
      <s-section>
        <s-heading>Auto Fulfillment Routing Settings</s-heading>
        <s-paragraph>
          When enabled, order items whose variant has Continue selling when out of stock enabled are moved to the selected fallback fulfillment location. Other items remain with Shopify's normal routing.
        </s-paragraph>

        {locationsError ? <s-banner tone="critical">Unable to load locations: {locationsError}</s-banner> : null}
        {actionData?.success ? <s-banner tone="success">Settings saved successfully.</s-banner> : null}

        <Form method="post">
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="checkbox" name="enabled" value="true" defaultChecked={settings.enabled} disabled={Boolean(locationsError)} />
              Enable Auto Routing
            </label>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="fallbackLocationId">Fallback Fulfillment Location</label>
            <br />
            <select id="fallbackLocationId" name="fallbackLocationId" defaultValue={settings.fallbackLocationId ?? ""} style={{ width: "100%", padding: "0.75rem", borderRadius: "0.5rem" }} disabled={Boolean(locationsError)}>
              <option value="">Select fallback location</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </div>

          <s-button type="submit" disabled={Boolean(locationsError)}>Save Settings</s-button>
        </Form>
>>>>>>> 9e4c2c592b902ec0c84295770032716c78d31109
      </s-section>
    </s-page>
  );
}
<<<<<<< HEAD

=======
>>>>>>> 9e4c2c592b902ec0c84295770032716c78d31109
