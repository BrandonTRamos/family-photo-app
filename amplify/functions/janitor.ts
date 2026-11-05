import { depsFromEnv } from '../../core/adapters/aws-deps.js';
import { makeJanitorHandler } from '../../core/handlers.js';

export const handler = makeJanitorHandler(depsFromEnv());
