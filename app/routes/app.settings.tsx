import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getAutoFulfillmentRoutingSettings,
  upsertAutoFulfillmentRoutingSettings,
} from "../services/auto-routing.server";

type LocationOption = {
  id: string;
  name: string;
};

type LoaderData = {
  locations: LocationOption[];
  settings: {
    enabled: boolean;
    fallbackLocationId?: string;
  };
  locationsError?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const shopResponse = await admin.graphql(`
    query {
      shop {
        myshopifyDomain
      }
    }
  `);
  const shopJson = await shopResponse.json();
  const shopDomain = shopJson?.data?.shop?.myshopifyDomain as string;

  let locations: LocationOption[] = [];
  let locationsError: string | undefined;

  try {
    const locationsResponse = await admin.graphql(`
      query {
        locations(first: 250) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `);

    const locationsJson = await locationsResponse.json();
    locations = (locationsJson?.data?.locations?.edges ?? []).map((edge: any) => ({
      id: edge.node.id,
      name: edge.node.name,
    }));
  } catch (error) {
    locationsError =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unable to load locations.";
    console.error(
      `[AutoRouting Settings] shop=${shopDomain} locations query failed: ${locationsError}`
    );
  }

  const settings = await getAutoFulfillmentRoutingSettings(shopDomain);

  return {
    locations,
    settings: {
      enabled: settings.enabled,
      fallbackLocationId: settings.fallbackLocationId,
    },
    locationsError,
  } as LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const shopResponse = await admin.graphql(`
    query {
      shop {
        myshopifyDomain
      }
    }
  `);
  const shopJson = await shopResponse.json();
  const shopDomain = shopJson?.data?.shop?.myshopifyDomain as string;

  const formData = await request.formData();
  const enabled = formData.get("enabled") === "true" || formData.get("enabled") === "on";
  const fallbackLocationId = String(formData.get("fallbackLocationId") || "");

  await upsertAutoFulfillmentRoutingSettings(
    shopDomain,
    enabled,
    fallbackLocationId || null,
    []
  );

  return { success: true };
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const { locations, settings, locationsError } = data;
  const locationsUnavailable = Boolean(locationsError);

  return (
    <s-page heading="Auto Fulfillment Routing">
      <s-section>
        <s-heading>Auto Fulfillment Routing Settings</s-heading>

        {locationsError ? (
          <s-banner tone="critical">
            Unable to load locations: {locationsError}. This often means the app is missing the
            required Shopify location access scopes (for example, <code>read_locations</code> or
            <code>write_locations</code>). Reauthorize or reinstall the app so the updated scopes
            can be granted, then refresh this page.
          </s-banner>
        ) : null}

        {actionData?.success && (
          <s-banner tone="success">Settings saved successfully.</s-banner>
        )}

        <Form method="post">
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                name="enabled"
                value="true"
                defaultChecked={settings.enabled}
                disabled={locationsUnavailable}
              />
              Enable Auto Routing
            </label>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="fallbackLocationId">Fallback Fulfillment Location</label>
            <br />
            <select
              id="fallbackLocationId"
              name="fallbackLocationId"
              defaultValue={settings.fallbackLocationId ?? ""}
              style={{ width: "100%", padding: "0.75rem", borderRadius: "0.5rem" }}
              disabled={locationsUnavailable}
            >
              <option value="">Select fallback location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>

          <s-button type="submit" disabled={locationsUnavailable}>
            Save Settings
          </s-button>
        </Form>
      </s-section>
    </s-page>
  );
}
