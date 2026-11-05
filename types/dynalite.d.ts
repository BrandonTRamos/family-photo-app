declare module 'dynalite' {
  import type { Server } from 'node:http';
  export default function dynalite(options?: Record<string, unknown>): Server;
}
