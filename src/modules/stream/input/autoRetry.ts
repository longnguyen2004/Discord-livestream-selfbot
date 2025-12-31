import { prepareStream } from "@dank074/discord-video-stream";
import { PassThrough } from "node:stream";
import { setTimeout } from "node:timers/promises";
import type { Controller } from "@dank074/discord-video-stream";

type RetryOptions = {
    maxRetries: number;
    retryDelay: number; 
}

export function autoRetry(
    stream: Parameters<typeof prepareStream>[0],
    options: Parameters<typeof prepareStream>[1],
    retryOptions: RetryOptions,
    cancelSignal?: AbortSignal
)
{
    let hasOutput = false;
    const out = new PassThrough({ highWaterMark: 0 });
    let currentController: Controller;
    let lastError: Error | undefined = undefined;
    const promise = (async() => {
        let retryCount = 0;
        while (retryOptions.maxRetries == -1 || retryCount <= retryOptions.maxRetries)
        {
            cancelSignal?.throwIfAborted();
            let hasOutputThisAttempt = false;
            const { output, promise, controller } = prepareStream(stream, options, cancelSignal);
            output.once("data", () => hasOutput = hasOutputThisAttempt = true);
            output.pipe(out, { end: false });
            currentController = controller;
            try
            {
                await promise;
            }
            catch (e)
            {
                lastError = e as Error;
            }
            if (cancelSignal?.aborted)
                break;
            if (hasOutputThisAttempt)
                retryCount = 0;
            await setTimeout(retryOptions.retryDelay, undefined, { signal: cancelSignal });
            retryCount++;
        }
        out.end();
        if (hasOutput)
            return;
        throw new Error(`Failed to get any output after ${retryOptions.maxRetries} retries`, { cause: lastError });
    })();
    promise.catch(() => {});
    return { output: out, promise, get controller() { return currentController; } };
}
