import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

type Product = {
  id: string;
  title: string;
  vendor: string;
  descriptionHtml: string | null;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const productId = params.id || "";

  const response = await admin.graphql(
    `#graphql
      query productById($id: ID!) {
        product(id: $id) {
          id
          title
          vendor
          descriptionHtml
        }
      }
    `,
    {
      variables: {
        id: productId,
      },
    },
  );

  const result = await response.json();
  const product = result.data?.product as Product | null;

  return {
    product,
  };
};

export default function ProductDetail() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Product Detail">
      <s-section>
        <s-heading>Dynamic Route Working 🎉</s-heading>

        <s-paragraph>
          Product ID: {data.product?.id}
        </s-paragraph>
      </s-section>
    </s-page>
  );
}