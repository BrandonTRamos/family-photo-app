# Family Archive

A private, shared place for the family's photos and videos. Browse by a Timeline (year, month, day), search by tags, group into Albums, and help date old scans. Terms are defined in [CONTEXT.md](CONTEXT.md); the spec is in [.scratch/family-archive/spec.md](.scratch/family-archive/spec.md).

## Layout

- `core/`: domain types, Item rules (`item.ts`: lifecycle, placement, Tags), use cases (`archive.ts`), processing and AI tagging (`pipeline.ts`), Lambda handlers, and adapters (DynamoDB, S3, SQS, Bedrock, MediaConvert, sharp, exifr). `core/api-types.ts` is the HTTP contract shared with the web app.
- `amplify/`: Amplify Gen 2 backend. Auth via `defineAuth`; everything else is CDK in `archive-resources.ts`.
- `src/`: React web app in the Lake house design. Runs in demo mode with sample photos when no backend is configured: the real Archive and HTTP API run in the page on in-memory adapters (`src/demo.ts`), with media processing stood in for.
- `tests/`: tests through the HTTP API, with the workers running behind it.

## Develop

```sh
npm install
npm test          # API-level tests through the real web client, run twice: DynamoDB emulator, then the in-memory Repository
npm run typecheck
npm run dev       # web app; demo mode until amplify_outputs.json exists
```

## Deploy (needs your AWS account)

1. Personal sandbox: `npx ampx sandbox` with AWS credentials configured. This writes `amplify_outputs.json`, and `npm run dev` then uses the real backend.
2. Hosting: connect this repo in the Amplify console. `amplify.yml` deploys the backend and builds the web app.
3. After the first deploy:
   - Bedrock: make sure Amazon Nova Lite is available to the account in the deploy region (the tagger calls the `us.amazon.nova-lite-v1:0` inference profile; change `BEDROCK_MODEL_ID` in `amplify/archive-resources.ts` for other regions).
   - Membership: people sign up in the app, then an admin adds them to the `family` group in the Cognito console. Until then the app asks them to wait.

## Defaults chosen (change as needed)

- Region us-east-1 (inference profile above assumes a US region).
- Uploads: JPEG, PNG, WebP, HEIC/HEIF photos up to 50 MB; MP4/MOV videos up to 2 GB. Large files upload in 16 MB parts.
- Staging originals are deleted after a verified publish; failed or abandoned ones expire after 30 days.
- Photos: 2048 px display JPEG and 400 px square thumbnail, all metadata (including GPS) stripped.
- Videos: H.264/AAC MP4 at 30 fps, 8 Mbps cap, plus a poster frame.
- Media is served with 1-hour presigned S3 links.

## Known gaps

- HEIC: the prebuilt sharp has no HEVC decoder, so HEIC photos currently fail processing (the original is kept). Needs a libheif-capable sharp build or layer.
- Video resolution is left at the source (frame rate is fixed at 30 fps); add a 1080p cap once tested against real MediaConvert output. Silent and variable-frame-rate video are untested against real MediaConvert.
- Media links are presigned S3, not signed CloudFront (CloudFront needs a key pair you create).
- A video whose MediaConvert completion event is lost stays "processing" until its ingest message is redelivered; there is no sweeper yet.
- Search matches exact tags; no stemming or semantic search.
