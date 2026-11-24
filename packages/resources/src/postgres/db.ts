import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgTransaction } from "drizzle-orm/node-postgres";
import type * as schema from "./schema.js";

export type ResourcesSchema = typeof schema;
export type ResourcesDatabase = NodePgDatabase<ResourcesSchema>;
export type ResourcesTransaction = NodePgTransaction<
  ResourcesSchema,
  ExtractTablesWithRelations<ResourcesSchema>
>;
