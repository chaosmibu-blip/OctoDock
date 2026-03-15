import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// 如果連線字串包含 sslmode=require，加上 uselibpqcompat=true 消除 pg 的 SSL warning
const dbUrl = process.env.DATABASE_URL ?? "";
const connectionString = dbUrl.includes("sslmode=require") && !dbUrl.includes("uselibpqcompat")
  ? dbUrl + "&uselibpqcompat=true"
  : dbUrl;

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
