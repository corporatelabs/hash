import { parentPort, workerData } from "node:worker_threads";
import { SqliteBackend } from "../../src/storage/sqlite.js";

const data = workerData as { dbPath: string; id: string; now: number };
const db = SqliteBackend.open(data.dbPath);
const result = await db.snippets.open(data.id, data.now);
parentPort?.postMessage(result);
db.close();
