import { defineQueryConfig } from "../src/core/config";

export const config = defineQueryConfig({
  limit: 50,
  fields: {
    project_id: { type: "string" },
    status: { type: "string", sort: true },
    name: { type: "string", sort: true },
    count: { type: "number", sort: true },
    reported: { type: "boolean" },
    created_at: { type: "date", sort: true },
    last_opened_at: { type: "date" },
    entity_ids: { type: "string", path: "entities.id" },
    internal: { type: "string", filter: false, sort: true },
  },
});

export const OID = "64b0c0c0c0c0c0c0c0c0c0c0";
export const OID2 = "64b0c0c0c0c0c0c0c0c0c0c1";
