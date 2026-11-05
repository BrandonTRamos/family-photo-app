import { depsFromEnv } from '../../core/adapters/aws-deps.js';
import { makePurgeHandler } from '../../core/handlers.js';

export const handler = makePurgeHandler(depsFromEnv());
