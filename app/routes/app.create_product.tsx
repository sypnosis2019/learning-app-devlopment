import type { ActionFunctionArgs } from "react-router";
import { Form, useActionData } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();

  const title = String(formData.get("title") || "");
  const vendor = String(formData.get("vendor") || "");
  const image = formData.get("image");

  let imageUrl = "";

  if (image instanceof File && image.size > 0) {
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
      }
    );

    const stagedUploadResult = await stagedUploadResponse.json();
    const stagedUploadError =
      stagedUploadResult.data.stagedUploadsCreate.userErrors[0];

    if (stagedUploadError) {
      return {
        product: null,
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
        product: null,
        userErrors: [
          {
            field: ["image"],
            message: "Image upload failed. Please try another image.",
          },
        ],
      };
    }

    imageUrl = stagedTarget.resourceUrl;
  }

  const media = imageUrl
    ? [
        {
          mediaContentType: "IMAGE",
          originalSource: imageUrl,
          alt: title,
        },
      ]
    : [];

  const response = await admin.graphql(
    `#graphql
      mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
        productCreate(product: $product, media: $media) {
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
          title,
          vendor,
        },
        media,
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

        <Form method="post" encType="multipart/form-data">
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

          <s-drop-zone
            label="Product image"
            accessibilityLabel="Upload product image"
            name="image"
            accept="image/*"
          ></s-drop-zone>

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

            {result.product.media?.nodes?.[0] && (
              <s-paragraph>
                Image status: {result.product.media.nodes[0].preview.status}
              </s-paragraph>
            )}
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
