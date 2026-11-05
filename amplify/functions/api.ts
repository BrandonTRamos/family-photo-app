import { depsFromEnv } from '../../core/adapters/aws-deps.js';
import { makeHttpHandler } from '../../core/handlers.js';

export const handler = makeHttpHandler(depsFromEnv());
