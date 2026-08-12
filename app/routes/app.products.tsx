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
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "12px 8px", borderBottom: "1px solid #dfe3e8" }}>
                  Title
                </th>
                <th style={{ textAlign: "left", padding: "12px 8px", borderBottom: "1px solid #dfe3e8" }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((product, index) => (
                <tr key={product.node.id ?? index}>
                  <td style={{ padding: "12px 8px", verticalAlign: "middle" }}>
                    {product.node.title}
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "right", verticalAlign: "middle" }}>
                    <s-link href={`/app/products/${product.node.id}`}>
                      <s-button type="button">View</s-button>
                    </s-link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <s-paragraph>No products found.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
