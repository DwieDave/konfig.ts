/**
 * Dummy worker entrypoint — pulls a batch every 5s, no-op in this demo.
 *
 * `workerEnv` (from @example/env-contracts) is the same bundle that
 * drives `Environment.bind` in `infra/modules/worker.ts`; consuming it
 * via `Environment.runtime(workerEnv)` keeps the contract symmetric.
 */
import { workerEnv } from "@example/env-contracts";
import { Environment } from "@konfig.ts/k8s";
import { Effect } from "effect";

const config = await Effect.runPromise(Environment.runtime(workerEnv));

const batchSize = config.worker.batchSize;
const concurrency = config.worker.concurrency;
const podName = config.runtime.podName;

const tick = async () => {
	console.log(
		`[${podName}] tick — would process ${batchSize} rows (concurrency=${concurrency})`,
	);
};

console.log(`worker starting (pod=${podName}, batch=${batchSize}, concurrency=${concurrency})`);
setInterval(tick, 5_000);
