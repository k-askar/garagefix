"""Cleanup iteration-5 QA/TEST data (payment entries, methods, invoices, POs, txns, items)."""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import dotenv_values

env = dotenv_values("/app/backend/.env")


async def main():
    c = AsyncIOMotorClient(env["MONGO_URL"])
    db = c[env["DB_NAME"]]
    res = {}
    res["entries"] = (await db.payment_entries.delete_many({"$or": [
        {"note": {"$regex": "TEST_PM|QA_UI"}},
        {"counterpart": {"$regex": "TEST_PM|QA_UI"}},
        {"method_name": {"$regex": "QA Wise|TEST_PM"}},
        {"reference_no": {"$regex": "PO-260820-5727|PO-260820-EB38|INV-260820-4FD5"}},
    ]})).deleted_count
    res["methods"] = (await db.payment_methods.delete_many({"name": {"$regex": "QA Wise|TEST_PM"}})).deleted_count
    res["invoices"] = (await db.invoices.delete_many({"customer_name": {"$regex": "TEST_PM|QA_UI"}})).deleted_count
    res["pos"] = (await db.purchase_orders.delete_many({"supplier_name": {"$regex": "TEST_PM|QA_UI"}})).deleted_count
    res["txns"] = (await db.transactions.delete_many({"item_name": {"$regex": "TEST_PM|QA_UI"}})).deleted_count
    res["items"] = (await db.inventory.delete_many({"name": {"$regex": "TEST_PM|QA_UI"}})).deleted_count
    res["customers"] = (await db.customers.delete_many({"name": {"$regex": "TEST_PM|QA_UI"}})).deleted_count
    res["suppliers"] = (await db.suppliers.delete_many({"name": {"$regex": "TEST_PM|QA_UI"}})).deleted_count
    print(res)
    remaining = await db.payment_entries.find({}, {"_id": 0, "method_name": 1, "amount": 1, "direction": 1, "reference_type": 1}).to_list(50)
    print("remaining entries:", remaining)

asyncio.run(main())
