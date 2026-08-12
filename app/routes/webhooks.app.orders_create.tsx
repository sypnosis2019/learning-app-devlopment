import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { processOrderAutoFulfillmentRouting } from "../services/auto-routing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) {
    console.log(`AutoRouting webhook skipped because no active session is available for ${shop}`);
    return new Response();
  }

  try {
    await processOrderAutoFulfillmentRouting(admin, shop, payload as Record<string, any>);
  } catch (error) {
    console.error(`AutoRouting webhook error for ${shop}:`, error);
  }

  return new Response();
};
