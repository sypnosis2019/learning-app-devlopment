import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
<<<<<<< HEAD

  // eslint-disable-next-line no-undef
=======
>>>>>>> 9e4c2c592b902ec0c84295770032716c78d31109
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
<<<<<<< HEAD
        <s-link href="/app">Home</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/additional">Additional page</s-link>
=======
        <s-link href="/app">Auto Fulfillment Routing</s-link>
>>>>>>> 9e4c2c592b902ec0c84295770032716c78d31109
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

<<<<<<< HEAD
// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
=======
>>>>>>> 9e4c2c592b902ec0c84295770032716c78d31109
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
