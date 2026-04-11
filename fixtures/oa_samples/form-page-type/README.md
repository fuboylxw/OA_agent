# Form-Page Type OA Sample

This is a mock OA system that uses HTML forms for submission.

## Sample Flow

**purchase_request** - 采购申请

Form fields:
- itemName (text) - 物品名称
- quantity (number) - 数量
- estimatedPrice (number) - 预估价格
- reason (textarea) - 采购理由

## Form URL

`http://localhost:8080/forms/purchase`

## Submission

Form submits to: `http://localhost:8080/forms/purchase/submit`
Method: POST
Content-Type: application/x-www-form-urlencoded
