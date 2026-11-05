import { depsFromEnv } from '../../core/adapters/aws-deps.js';
import { makeTaggingHandler } from '../../core/handlers.js';
import { SharpImageProcessor } from '../../core/media/sharp-images.js';

export const handler = makeTaggingHandler(depsFromEnv(new SharpImageProcessor()));
