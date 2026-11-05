import { depsFromEnv } from '../../core/adapters/aws-deps.js';
import { makeProcessingHandler } from '../../core/handlers.js';
import { SharpImageProcessor } from '../../core/media/sharp-images.js';

export const handler = makeProcessingHandler(depsFromEnv(new SharpImageProcessor()));
