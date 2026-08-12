import db from "../db.server";

type ShopifyAdminApi = {
  graphql(query: string, options?: { variables?: Record<string, any> }): Promise<Response>;
};

export type AutoFulfillmentRoutingSettings = {
  enabled: boolean;
  fallbackLocationId?: string;
  normalLocationIds: string[];
};

const defaultSettings: AutoFulfillmentRoutingSettings = {
  enabled: false,
  fallbackLocationId: undefined,
  normalLocationIds: [],
};

export async function getAutoFulfillmentRoutingSettings(shop: string): Promise<AutoFulfillmentRoutingSettings> {
  const [record] = (await db.$queryRaw`
    SELECT enabled, fallbackLocationId, normalLocationIds
    FROM AutoFulfillmentRoutingSetting
    WHERE shop = ${shop}
  `) as Array<{
    enabled: number | boolean;
    fallbackLocationId: string | null;
    normalLocationIds: string | string[] | null;
  }>;

  if (!record) return defaultSettings;

  const rawLocationData = record.normalLocationIds;
  const normalLocationIds = Array.isArray(rawLocationData)
    ? rawLocationData.filter((id: unknown): id is string => typeof id === "string")
    : typeof rawLocationData === "string"
      ? JSON.parse(rawLocationData) as string[]
      : [];

  return {
    enabled: Boolean(record.enabled),
    fallbackLocationId: record.fallbackLocationId ?? undefined,
    normalLocationIds,
  };
}

export async function upsertAutoFulfillmentRoutingSettings(
  shop: string,
  enabled: boolean,
  fallbackLocationId: string | null,
  normalLocationIds: string[]
): Promise<AutoFulfillmentRoutingSettings> {
  const encodedLocations = JSON.stringify(normalLocationIds);
  await db.$executeRaw`
    INSERT INTO AutoFulfillmentRoutingSetting (shop, enabled, fallbackLocationId, normalLocationIds)
    VALUES (${shop}, ${enabled ? 1 : 0}, ${fallbackLocationId}, ${encodedLocations})
    ON CONFLICT(shop) DO UPDATE SET
      enabled = excluded.enabled,
      fallbackLocationId = excluded.fallbackLocationId,
      normalLocationIds = excluded.normalLocationIds
  `;

  return { enabled, fallbackLocationId: fallbackLocationId ?? undefined, normalLocationIds };
}

function getOrderIdFromPayload(payload: Record<string, any>): string | undefined {
  // Shopify orders/create payload uses a numeric REST order id.
  const rawOrderId = payload?.id ?? payload?.order?.id;
  if (typeof rawOrderId === "string" && rawOrderId.length > 0) return rawOrderId;
  if (typeof rawOrderId === "number" && Number.isFinite(rawOrderId)) return String(rawOrderId);
  return undefined;
}

export async function processOrderAutoFulfillmentRouting(
  admin: ShopifyAdminApi,
  shop: string,
  payload: Record<string, any>
): Promise<void> {
  const settings = await getAutoFulfillmentRoutingSettings(shop);

  if (!settings.enabled) {
    console.log(`[AutoRouting] shop=${shop} status=disabled decision=skipped no settings enabled`);
    return;
  }

  if (!settings.fallbackLocationId) {
    console.log(`[AutoRouting] shop=${shop} status=invalid-settings decision=skipped no fallback location configured`);
    return;
  }

  const orderId = getOrderIdFromPayload(payload);
  if (!orderId) {
    console.log(`[AutoRouting] shop=${shop} status=invalid-payload decision=skipped could-not-read-order-id payloadKeys=${Object.keys(payload ?? {}).join(",")}`);
    return;
  }

  console.log(`[AutoRouting] shop=${shop} order=${orderId} webhook-payload-order-id-detected`);

  const orderResponse = await admin.graphql(
    `#graphql
      query orderFulfillmentData($id: ID!) {
        order(id: $id) {
          id
          name
          lineItems(first: 250) {
            edges {
              node {
                id
                variant {
                  id
                  inventoryPolicy
                  inventoryItem { id }
                }
              }
            }
          }
          fulfillmentOrders(first: 50) {
            edges {
              node {
                id
                status
                assignedLocation { id name }
              }
            }
          }
        }
      }
    `,
    { variables: { id: orderId } }
  );

  const orderResult = await orderResponse.json();
  if (orderResult?.errors?.length > 0) {
    console.error(`[AutoRouting] shop=${shop} order=${orderId} graphql-order-errors=${JSON.stringify(orderResult.errors)}`);
    return;
  }

  const order = orderResult?.data?.order;
  const orderName = order?.name ?? orderId;
  if (!order) {
    console.log(`[AutoRouting] shop=${shop} order=${orderName} status=missing-order decision=skipped`);
    return;
  }

  const eligibleVariants = (order.lineItems?.edges ?? [])
    .map((edge: any) => edge.node)
    .filter((lineItem: any) => lineItem?.variant?.inventoryPolicy === "CONTINUE")
    .map((lineItem: any) => ({
      variantId: lineItem.variant.id,
      inventoryItemId: lineItem.variant.inventoryItem?.id,
      inventoryPolicy: lineItem.variant.inventoryPolicy,
    }));

  if (eligibleVariants.length === 0) {
    console.log(`[AutoRouting] shop=${shop} order=${orderName} decision=skipped no-continuable-variants`);
    return;
  }

  console.log(`[AutoRouting] shop=${shop} order=${orderName} eligibleVariants=${eligibleVariants.length} decision=Move to Fallback`);

  const fulfillmentOrderEdges = order.fulfillmentOrders?.edges ?? [];
  if (fulfillmentOrderEdges.length === 0) {
    console.log(`[AutoRouting] shop=${shop} order=${orderName} decision=no-fulfillment-orders`);
    return;
  }

  for (const edge of fulfillmentOrderEdges) {
    const fulfillmentOrder = edge.node;
    if (!fulfillmentOrder?.id) continue;

    const assignedLocationId = fulfillmentOrder.assignedLocation?.id;
    if (assignedLocationId === settings.fallbackLocationId) {
      console.log(`[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} decision=already-at-fallback location=${assignedLocationId}`);
      continue;
    }

    const moveResponse = await admin.graphql(
      `#graphql
        mutation moveFulfillmentOrder($fulfillmentOrderId: ID!, $locationId: ID!) {
          fulfillmentOrderMove(
            fulfillmentOrderId: $fulfillmentOrderId
            moveFulfillmentOrderInput: { assignedLocationId: $locationId }
          ) {
            fulfillmentOrder { id assignedLocation { id name } }
            userErrors { field message }
          }
        }
      `,
      { variables: { fulfillmentOrderId: fulfillmentOrder.id, locationId: settings.fallbackLocationId } }
    );

    const moveResult = await moveResponse.json();
    const moveData = moveResult?.data?.fulfillmentOrderMove;
    const userErrors = moveData?.userErrors ?? [];

    if (userErrors.length > 0) {
      console.error(`[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} move-errors=${JSON.stringify(userErrors)}`);
      continue;
    }

    if (moveResult?.errors?.length > 0) {
      console.error(`[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} graphql-errors=${JSON.stringify(moveResult.errors)}`);
      continue;
    }

    const movedLocationId = moveData?.fulfillmentOrder?.assignedLocation?.id;
    const movedLocationName = moveData?.fulfillmentOrder?.assignedLocation?.name;
    console.log(`[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} decision=moved-to-fallback locationId=${movedLocationId} locationName=${movedLocationName}`);
  }
}
