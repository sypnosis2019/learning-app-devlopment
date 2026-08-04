import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

type Product = {
  id: string;
  title: string;
  vendor: string;
};

type ProductEdge = {
  node: Product;
};

async function uploadProductImage(admin: any, image: File, alt: string) {
  const stagedUploadResponse = await admin.graphql(
    `#graphql
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
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
        input: [
          {
            resource: "IMAGE",
            filename: image.name,
            mimeType: image.type,
            httpMethod: "POST",
          },
        ],
      },
    },
  );

  const stagedUploadResult = await stagedUploadResponse.json();
  const stagedUploadError =
    stagedUploadResult.data.stagedUploadsCreate.userErrors[0];

  if (stagedUploadError) {
    return {
      media: [],
      userErrors: [stagedUploadError],
    };
  }

  const stagedTarget =
    stagedUploadResult.data.stagedUploadsCreate.stagedTargets[0];

  const imageUploadFormData = new FormData();

  for (const parameter of stagedTarget.parameters) {
    imageUploadFormData.append(parameter.name, parameter.value);
  }

  imageUploadFormData.append("file", image);

  const uploadResponse = await fetch(stagedTarget.url, {
    method: "POST",
    body: imageUploadFormData,
  });

  if (!uploadResponse.ok) {
    return {
      media: [],
      userErrors: [
        {
          field: ["image"],
          message: "Image upload failed. Please try another image.",
        },
      ],
    };
  }

  return {
    media: [
      {
        mediaContentType: "IMAGE",
        originalSource: stagedTarget.resourceUrl,
        alt,
      },
    ],
    userErrors: [],
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const selectedProductId = new URL(request.url).searchParams.get("productId");

  const productsResponse = await admin.graphql(
    `#graphql
      query {
        products(first: 5) {
          edges {
            node {
              id
              title
              vendor
            }
          }
        }
      }
    `,
  );

  const productsResult = await productsResponse.json();
  const products = (productsResult.data.products.edges ?? []) as ProductEdge[];

  const selectedProduct = selectedProductId
    ? products.find((product) => product.node.id === selectedProductId)?.node ??
      null
    : null;

  return {
    products,
    selectedProduct,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const id = String(formData.get("productId") || "");
  const title = String(formData.get("title") || "");
  const vendor = String(formData.get("vendor") || "");
  const image = formData.get("image");

  let media: Array<{
    mediaContentType: string;
    originalSource: string;
    alt: string;
  }> = [];

  if (image instanceof File && image.size > 0) {
    const uploadResult = await uploadProductImage(admin, image, title);

    if (uploadResult.userErrors.length > 0) {
      return {
        product: null,
        userErrors: uploadResult.userErrors,
      };
    }

    media = uploadResult.media;
  }

  const response = await admin.graphql(
    `#graphql
      mutation productUpdate($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
        productUpdate(product: $product, media: $media) {
          product {
            id
            title
            vendor
            media(first: 1) {
              nodes {
                alt
                mediaContentType
                preview {
                  status
                }
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
        product: {
          id,
          title,
          vendor,
        },
        media,
      },
    },
  );

  const result = await response.json();

  return result.data.productUpdate;
};

export default function UpdateProduct() {
  const { products, selectedProduct } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();

  return (
    <s-page heading="Update Product">
      <s-section heading="Select a product to edit">
        {products.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "12px 8px", borderBottom: "1px solid #dfe3e8" }}>
                  Title
                </th>
                <th style={{ textAlign: "left", padding: "12px 8px", borderBottom: "1px solid #dfe3e8" }}>
                  Vendor
                </th>
                <th style={{ textAlign: "right", padding: "12px 8px", borderBottom: "1px solid #dfe3e8" }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((product, index) => (
                <tr key={product.node.id ?? index}>
                  <td style={{ padding: "12px 8px", verticalAlign: "middle" }}>
                    {product.node.title}
                  </td>
                  <td style={{ padding: "12px 8px", verticalAlign: "middle" }}>
                    {product.node.vendor}
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "right", verticalAlign: "middle" }}>
                    <Form method="get">
                      <input
                        type="hidden"
                        name="productId"
                        value={product.node.id}
                      />
                      <s-button type="submit">Edit</s-button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <s-paragraph>No products found.</s-paragraph>
        )}
      </s-section>

      {selectedProduct ? (
        <s-section heading="Edit product details">
          <Form
            key={selectedProduct.id}
            method="post"
            encType="multipart/form-data"
          >
            <input
              type="hidden"
              name="productId"
              value={selectedProduct.id}
            />

            <s-text-field
              label="Product Title"
              name="title"
              defaultValue={selectedProduct.title}
              required
            ></s-text-field>

            <br />

            <s-text-field
              label="Vendor"
              name="vendor"
              defaultValue={selectedProduct.vendor}
              required
            ></s-text-field>

            <br />

            <s-drop-zone
              label="Product image"
              accessibilityLabel="Upload product image"
              name="image"
              accept="image/*"
            ></s-drop-zone>

            <br />

            <s-button type="submit">Update Product</s-button>
          </Form>
        </s-section>
      ) : (
        <s-section>
          <s-paragraph>
            Select a product from the list above to update its title, vendor, or image.
          </s-paragraph>
        </s-section>
      )}

      {result?.product && (
        <s-section heading="Update result">
          <s-banner tone="success">Product updated successfully.</s-banner>

          <s-paragraph>
            <strong>Product Name:</strong> {result.product.title}
          </s-paragraph>
          <s-paragraph>
            <strong>Vendor:</strong> {result.product.vendor}
          </s-paragraph>

          {result.product.media?.nodes?.[0] && (
            <s-paragraph>
              <strong>Image status:</strong> {result.product.media.nodes[0].preview.status}
            </s-paragraph>
          )}
        </s-section>
      )}

      {result?.userErrors?.length > 0 && (
        <s-section heading="Error">
          <s-banner tone="critical">{result.userErrors[0].message}</s-banner>
        </s-section>
      )}
    </s-page>
  );
}
