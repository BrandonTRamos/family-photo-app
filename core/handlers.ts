// Lambda entry points, built from dependencies so tests and AWS wire them the same way. The HTTP API is in http-api.ts.
import type { SQSBatchResponse, SQSHandler } from 'aws-lambda';
import { Pipeline } from './pipeline.js';
import type { Deps, ProcessingMessage } from './ports.js';

export { makeHttpHandler } from './http-api.js';

export function makeProcessingHandler(deps: Deps): SQSHandler {
  const pipeline = new Pipeline(deps);
  return batch((body) => {
    const parsed = JSON.parse(body);
    const msg: ProcessingMessage | undefined = parsed?.kind === 'ingest' ? parsed : deps.transcoder.parseEvent(parsed);
    if (!msg) {
      console.warn('Ignoring unrecognized processing message');
      return Promise.resolve();
    }
    return pipeline.handle(msg);
  });
}

export function makeTaggingHandler(deps: Deps): SQSHandler {
  const pipeline = new Pipeline(deps);
  return batch((body) => {
    const parsed = JSON.parse(body) as { kind?: string; itemId?: unknown };
    if (parsed?.kind !== 'tag' || typeof parsed.itemId !== 'string') return Promise.resolve();
    return pipeline.tag(parsed.itemId);
  });
}

function batch(run: (body: string) => Promise<void>): SQSHandler {
  return async (event): Promise<SQSBatchResponse> => {
    const failures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      try {
        await run(record.body);
      } catch (err) {
        console.error(`Message ${record.messageId} failed`, err);
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}
