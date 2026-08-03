import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

type ProductEdge = {
  node: {
    id: string;
    title: string;
  };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query {
      products(first: 5) {
        edges {
          node {
            id
            title
          }
        }
      }
    }
  `);
  const responseJson = await response.json();

  return {
    products: (responseJson?.data?.products?.edges ?? []) as ProductEdge[],
  };
};

export default function Products() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Products">
      <s-section>
        <s-heading>First 5 Products</s-heading>
        {data.products.length ? (
          <s-unordered-list>
            {data.products.map((product, index) => (
              <s-list-item key={product.node.id ?? index}>
                {product.node.title}
              </s-list-item>
            ))}
          </s-unordered-list>
        ) : (
          <s-paragraph>No products found.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
