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

export async function getAutoFulfillmentRoutingSettings(
  shop: string
): Promise<AutoFulfillmentRoutingSettings> {
  const [record] = (await db.$queryRaw`
    SELECT enabled, fallbackLocationId, normalLocationIds
    FROM AutoFulfillmentRoutingSetting
    WHERE shop = ${shop}
  `) as Array<{
    enabled: number | boolean;
    fallbackLocationId: string | null;
    normalLocationIds: string | string[] | null;
  }>;

  if (!record) {
    return defaultSettings;
  }

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

  return {
    enabled,
    fallbackLocationId: fallbackLocationId ?? undefined,
    normalLocationIds,
  };
}

function getOrderIdFromPayload(payload: Record<string, any>): string | undefined {
  if (typeof payload?.id === "string") {
    return payload.id;
  }

  if (typeof payload?.order?.id === "string") {
    return payload.order.id;
  }

  return undefined;
}

function stringifyLocationInventory(inventory: Record<string, number>) {
  return Object.entries(inventory)
    .map(([locationId, available]) => `${locationId}:${available}`)
    .join(", ");
}

export async function processOrderAutoFulfillmentRouting(
  admin: ShopifyAdminApi,
  shop: string,
  payload: Record<string, any>
): Promise<void> {
  const settings = await getAutoFulfillmentRoutingSettings(shop);

  if (!settings.enabled) {
    console.log(
      `[AutoRouting] shop=${shop} status=disabled decision=skipped no settings enabled`
    );
    return;
  }

  if (!settings.fallbackLocationId) {
    console.log(
      `[AutoRouting] shop=${shop} status=invalid-settings decision=skipped no fallback location configured`
    );
    return;
  }

  if (settings.normalLocationIds.length === 0) {
    console.log(
      `[AutoRouting] shop=${shop} status=invalid-settings decision=skipped no normal locations configured`
    );
    return;
  }

  const orderId = getOrderIdFromPayload(payload);
  if (!orderId) {
    console.log(
      `[AutoRouting] shop=${shop} status=invalid-payload decision=skipped could-not-read-order-id`
    );
    return;
  }

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
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
          fulfillmentOrders(first: 50) {
            edges {
              node {
                id
                status
                assignedLocation {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `,
    {
      variables: { id: orderId },
    }
  );

  const orderResult = await orderResponse.json();
  const order = orderResult?.data?.order;
  const orderName = order?.name ?? orderId;

  if (!order) {
    console.log(
      `[AutoRouting] shop=${shop} order=${orderName} status=missing-order decision=skipped`
    );
    return;
  }

  const eligibleVariants = (order.lineItems?.edges ?? [])
    .map((edge: any) => edge.node)
    .filter((lineItem: any) => {
      const variant = lineItem?.variant;
      return (
        variant?.inventoryPolicy === "CONTINUE" &&
        typeof variant.inventoryItem?.id === "string"
      );
    })
    .map((lineItem: any) => ({
      variantId: lineItem.variant.id,
      inventoryItemId: lineItem.variant.inventoryItem.id,
      inventoryPolicy: lineItem.variant.inventoryPolicy,
    }));

  if (eligibleVariants.length === 0) {
    console.log(
      `[AutoRouting] shop=${shop} order=${orderName} decision=skipped no-continuable-variants`
    );
    return;
  }

  const uniqueInventoryItemIds = Array.from(
    new Set(eligibleVariants.map((item: { inventoryItemId: string }) => item.inventoryItemId))
  );

  let anyNormalInventoryAvailable = false;
  const inventorySummaryByVariantId: Record<string, number> = {};

  for (const variant of eligibleVariants) {
    const inventoryItemResponse = await admin.graphql(
      `#graphql
        query inventoryItemLevels($id: ID!) {
          inventoryItem(id: $id) {
            id
            inventoryLevels(first: 100) {
              edges {
                node {
                  available
                  location {
                    id
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: { id: variant.inventoryItemId },
      }
    );

    const inventoryItemResult = await inventoryItemResponse.json();
    const inventoryItem = inventoryItemResult?.data?.inventoryItem;

    if (!inventoryItem) {
      console.log(
        `[AutoRouting] shop=${shop} order=${orderName} variant=${variant.variantId} status=missing-inventory-item decision=skipped`
      );
      continue;
    }

    const normalInventory = (inventoryItem.inventoryLevels?.edges ?? [])
      .map((edge: any) => edge.node)
      .filter((node: any) =>
        settings.normalLocationIds.includes(node.location?.id)
      )
      .reduce((sum: number, node: any) => sum + Number(node.available ?? 0), 0);

    inventorySummaryByVariantId[variant.variantId] = normalInventory;

    console.log(
      `[AutoRouting] shop=${shop} order=${orderName} variant=${variant.variantId} inventoryPolicy=${variant.inventoryPolicy} normalLocationInventory=${normalInventory}`
    );

    if (normalInventory > 0) {
      anyNormalInventoryAvailable = true;
      break;
    }
  }

  const decision = anyNormalInventoryAvailable
    ? "Stayed in Normal Warehouse"
    : "Moved to Fallback";

  if (anyNormalInventoryAvailable) {
    console.log(
      `[AutoRouting] shop=${shop} order=${orderName} decision=${decision} fallbackLocation=${settings.fallbackLocationId}`
    );
    return;
  }

  const fulfillmentOrderEdges = order.fulfillmentOrders?.edges ?? [];
  if (fulfillmentOrderEdges.length === 0) {
    console.log(
      `[AutoRouting] shop=${shop} order=${orderName} decision=no-fulfillment-orders`
    );
    return;
  }

  for (const edge of fulfillmentOrderEdges) {
    const fulfillmentOrder = edge.node;
    if (!fulfillmentOrder?.id) {
      continue;
    }

    const assignedLocationId = fulfillmentOrder.assignedLocation?.id;
    if (assignedLocationId === settings.fallbackLocationId) {
      console.log(
        `[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} decision=already-at-fallback location=${assignedLocationId}`
      );
      continue;
    }

    const moveResponse = await admin.graphql(
      `#graphql
        mutation moveFulfillmentOrder($fulfillmentOrderId: ID!, $locationId: ID!) {
          fulfillmentOrderMove(
            fulfillmentOrderId: $fulfillmentOrderId
            moveFulfillmentOrderInput: { assignedLocationId: $locationId }
          ) {
            fulfillmentOrder {
              id
              assignedLocation {
                id
                name
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          fulfillmentOrderId: fulfillmentOrder.id,
          locationId: settings.fallbackLocationId,
        },
      }
    );

    const moveResult = await moveResponse.json();
    const moveData = moveResult?.data?.fulfillmentOrderMove;
    const userErrors = moveData?.userErrors ?? [];

    if (userErrors.length > 0) {
      console.error(
        `[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} move-errors=${JSON.stringify(
          userErrors
        )}`
      );
      continue;
    }

    if (moveResult?.errors?.length > 0) {
      console.error(
        `[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} graphql-errors=${JSON.stringify(
          moveResult.errors
        )}`
      );
      continue;
    }

    const movedLocationId = moveData?.fulfillmentOrder?.assignedLocation?.id;
    const movedLocationName = moveData?.fulfillmentOrder?.assignedLocation?.name;

    console.log(
      `[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} decision=moved-to-fallback locationId=${movedLocationId} locationName=${movedLocationName}`
    );
  }
}
