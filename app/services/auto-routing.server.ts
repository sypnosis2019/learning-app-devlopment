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

function getOrderGraphqlIdFromPayload(payload: Record<string, any>): string | undefined {
  // Prefer Shopify's GraphQL Admin ID from the webhook payload.
  if (typeof payload?.admin_graphql_api_id === "string" && payload.admin_graphql_api_id.length > 0) {
    return payload.admin_graphql_api_id;
  }

  // Fallback for webhook payloads that only contain the legacy numeric REST ID.
  const rawOrderId = payload?.id ?? payload?.order?.id;
  if (typeof rawOrderId === "string" && rawOrderId.length > 0) {
    return rawOrderId.startsWith("gid://shopify/Order/")
      ? rawOrderId
      : `gid://shopify/Order/${rawOrderId}`;
  }

  if (typeof rawOrderId === "number" && Number.isFinite(rawOrderId)) {
    return `gid://shopify/Order/${rawOrderId}`;
  }

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

  const orderId = getOrderGraphqlIdFromPayload(payload);
  if (!orderId) {
    console.log(`[AutoRouting] shop=${shop} status=invalid-payload decision=skipped could-not-read-order-id payloadKeys=${Object.keys(payload ?? {}).join(",")}`);
    return;
  }

  console.log(`[AutoRouting] shop=${shop} order=${orderId} graphql-order-id-detected`);

  const orderResponse = await admin.graphql(
    `#graphql
      query orderFulfillmentData($id: ID!) {
        order(id: $id) {
          id
          name
          fulfillmentOrders(first: 50) {
            edges {
              node {
                id
                status
                requestStatus
                assignedLocation {
                  location {
                    id
                    name
                  }
                }
                lineItems(first: 250) {
                  edges {
                    node {
                      id
                      remainingQuantity
                      variant {
                        id
                        inventoryPolicy
                      }
                    }
                  }
                }
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

  const fulfillmentOrderEdges = order.fulfillmentOrders?.edges ?? [];
  if (fulfillmentOrderEdges.length === 0) {
    console.log(`[AutoRouting] shop=${shop} order=${orderName} decision=no-fulfillment-orders`);
    return;
  }

  for (const edge of fulfillmentOrderEdges) {
    const fulfillmentOrder = edge.node;
    if (!fulfillmentOrder?.id) continue;

    const eligibleLineItems = (fulfillmentOrder.lineItems?.edges ?? [])
      .map((lineItemEdge: any) => lineItemEdge.node)
      .filter((lineItem: any) =>
        lineItem?.remainingQuantity > 0 &&
        lineItem?.variant?.inventoryPolicy === "CONTINUE"
      )
      .map((lineItem: any) => ({
        id: lineItem.id,
        quantity: lineItem.remainingQuantity,
        variantId: lineItem.variant.id,
      }));

    if (eligibleLineItems.length === 0) {
      console.log(
        `[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} decision=skipped no-continuable-line-items`
      );
      continue;
    }

    const assignedLocationId = fulfillmentOrder.assignedLocation?.location?.id;
    if (assignedLocationId === settings.fallbackLocationId) {
      console.log(
        `[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} decision=already-at-fallback location=${assignedLocationId}`
      );
      continue;
    }

    console.log(
      `[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} eligibleLineItems=${eligibleLineItems.length} decision=Move eligible items to Fallback`
    );

    const moveResponse = await admin.graphql(
      `#graphql
        mutation fulfillmentOrderMove($id: ID!, $newLocationId: ID!, $fulfillmentOrderLineItems: [FulfillmentOrderLineItemInput!]) {
          fulfillmentOrderMove(
            id: $id
            newLocationId: $newLocationId
            fulfillmentOrderLineItems: $fulfillmentOrderLineItems
          ) {
            movedFulfillmentOrder {
              id
              status
              assignedLocation {
                location {
                  id
                  name
                }
              }
            }
            originalFulfillmentOrder {
              id
              status
              assignedLocation {
                location {
                  id
                  name
                }
              }
            }
            remainingFulfillmentOrder {
              id
              status
              assignedLocation {
                location {
                  id
                  name
                }
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
          id: fulfillmentOrder.id,
          newLocationId: settings.fallbackLocationId,
          fulfillmentOrderLineItems: eligibleLineItems.map((item: { id: string; quantity: number }) => ({
            id: item.id,
            quantity: item.quantity,
          })),
        },
      }
    );

    const moveResult = await moveResponse.json();
    const moveData = moveResult?.data?.fulfillmentOrderMove;
    const userErrors = moveData?.userErrors ?? [];

    if (userErrors.length > 0) {
      console.error(
        `[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} move-errors=${JSON.stringify(userErrors)}`
      );
      continue;
    }

    if (moveResult?.errors?.length > 0) {
      console.error(
        `[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} graphql-errors=${JSON.stringify(moveResult.errors)}`
      );
      continue;
    }

    const moved = moveData?.movedFulfillmentOrder;
    const movedLocationId = moved?.assignedLocation?.location?.id;
    const movedLocationName = moved?.assignedLocation?.location?.name;

    console.log(
      `[AutoRouting] shop=${shop} order=${orderName} fulfillmentOrder=${fulfillmentOrder.id} decision=moved-to-fallback locationId=${movedLocationId} locationName=${movedLocationName}`
    );
  }
}
