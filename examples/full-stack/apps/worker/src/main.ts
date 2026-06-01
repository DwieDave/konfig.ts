/**
 * Dummy worker entrypoint — pulls a batch every 5s, no-op in this demo.
 *
 * Consumes the same DATABASE_URL as the api via the shared
 * `dbCreds` secret declared in @example/env-contracts.
 */
const batchSize = Number(process.env.BATCH_SIZE ?? 100);
const podName = process.env.POD_NAME ?? "local";

const tick = async () => {
	console.log(`[${podName}] tick — would process ${batchSize} rows`);
};

console.log(`worker starting (pod=${podName}, batch=${batchSize})`);
setInterval(tick, 5_000);
