import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/** Marks work done by the Admin simulator, so its emails follow the test-mode rule (never a real person). */
const store = new AsyncLocalStorage<{ simulated: boolean }>();
export const runSimulated = <T>(fn: () => Promise<T>) => store.run({ simulated: true }, fn);
export const isSimulatedContext = () => store.getStore()?.simulated === true;
