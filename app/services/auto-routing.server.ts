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