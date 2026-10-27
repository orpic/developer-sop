// Upgrades a store written before the owner became a setting: the stored name becomes "owner"
// and needs_<name> becomes needs_owner. Dry run by default; add --apply to write.
//   node tools/migrate-owner-role.mjs --old <name> [--apply]
import { MongoClient } from "mongodb";

const args = process.argv.slice(2);
const oldName = args[args.indexOf("--old") + 1];
if (!args.includes("--old") || !oldName) {
  console.error("usage: node tools/migrate-owner-role.mjs --old <name> [--apply]");
  process.exit(1);
}
const apply = args.includes("--apply");
const url = process.env.DEVELOPER_SOP_URL || "mongodb://127.0.0.1:27027/developer-sop";
const oldField = `needs_${oldName}`;

const client = new MongoClient(url);
await client.connect();
const db = client.db();

const steps = [
  ["decisions", { [oldField]: { $exists: true } }, { $rename: { [oldField]: "needs_owner" } }],
  ["decisions", { decided_by: oldName }, { $set: { decided_by: "owner" } }],
  ["decisions", { "approved.by": oldName }, { $set: { "approved.by": "owner" } }],
  ["open_items", { owner: oldName }, { $set: { owner: "owner" } }],
];
for (const { name } of await db.listCollections().toArray()) {
  steps.push([name, { created_by: oldName }, { $set: { created_by: "owner" } }]);
}

for (const [collection, filter, update] of steps) {
  const count = await db.collection(collection).countDocuments(filter);
  if (!count) continue;
  console.log(`${apply ? "updating" : "would update"} ${count} in ${collection}: ${JSON.stringify(filter)}`);
  if (apply) await db.collection(collection).updateMany(filter, update, { bypassDocumentValidation: true });
}

if (!apply) {
  console.log("dry run only, nothing written. Add --apply to write.");
} else {
  const decisions = db.collection("decisions");
  if ((await decisions.indexes()).some((i) => i.name === `${oldField}_1_approved.at_1`)) {
    await decisions.dropIndex(`${oldField}_1_approved.at_1`);
  }
  console.log("done. Now apply the new schema:");
  console.log("  docker exec -i developer-sop-mongo mongosh --quiet < init/01-collections.js");
}
await client.close();
