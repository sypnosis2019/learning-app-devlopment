import type { ActionFunctionArgs } from "react-router";
import { Form, useActionData } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();

  const title = String(formData.get("title") || "");
  const vendor = String(formData.get("vendor") || "");

  const response = await admin.graphql(
    `#graphql
      mutation productCreate($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            vendor
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
        product: {
          title,
          vendor,
        },
      },
    }
  );

  const result = await response.json();

  return result.data.productCreate;
};

export default function CreateProduct() {
  const result = useActionData<typeof action>();

  return (
    <s-page heading="Create Product">
      <s-section>
        <s-heading>Create New Product</s-heading>

        <Form method="post">
          <s-text-field
            label="Product Title"
            name="title"
          ></s-text-field>

          <br />

          <s-text-field
            label="Vendor"
            name="vendor"
          ></s-text-field>

          <br />

          <s-button type="submit">
            Create Product
          </s-button>
        </Form>

        {result?.product && (
          <>
            <br />

            <s-banner tone="success">
              Product Created Successfully 🎉
            </s-banner>

            <s-paragraph>
              Product Name: {result.product.title}
            </s-paragraph>

            <s-paragraph>
              Vendor: {result.product.vendor}
            </s-paragraph>
          </>
        )}

        {result?.userErrors?.length > 0 && (
          <>
            <br />

            <s-banner tone="critical">
              {result.userErrors[0].message}
            </s-banner>
          </>
        )}
      </s-section>
    </s-page>
  );
}