# Family photo album: coding-agent handoff

Updated November 4, 2026. This summarizes discussions and the latest planning document. It is a handoff, not permission to deploy, modify existing media, or assume an implementation already exists. Inspect the repository and its instructions first; a local project named `family-photo-app` appeared in a screenshot, but its contents and status have not been verified.

## Product goal and confirmed direction

- One shared family archive for both older memories and new moments, with family contributions.
- Support photos and videos. Upload and browse by date and tags; search results show thumbnails and open the full retained image when selected.
- Favor inexpensive AWS serverless infrastructure.
- Use Amazon Bedrock vision to inspect **photos** and generate tags based on what each image actually contains. Tags should be ad hoc, not confined to a predefined label list. Do not run AI tagging on videos or video posters.
- AWS handles all photo and video compression in the current baseline. Client-side compression was discussed as a possibility, but was not adopted.
- Compressed-only retention is acceptable when cheaper; a separate backup copy is not part of the baseline. This does not authorize deleting any existing media.
- Rekognition was considered, not selected. The later request for open-ended image understanding supports the existing Bedrock direction.

## Proposed architecture, not yet deployed

The planning document recommends the following. Treat it as a starting design to validate against the existing code, not as proof of a completed system.

1. Cognito sign-in; API Gateway and Lambda authorize family membership and issue constrained upload grants. Upload original files to private S3 staging, with size/type validation and multipart-upload cleanup.
2. A processing SQS queue invokes Lambda. For photos, use Lambda/Sharp to create a compressed display image and thumbnail. Extract capture date, time offset, orientation and relevant private metadata before conversion. HEIC support requires a tested libheif-capable build.
3. For videos, a Lambda submits a MediaConvert job and returns; do not hold it open while encoding. The proposed baseline is one 1080p/30 fps AVC/H.264 + AAC MP4 and a poster. EventBridge routes completion, failure and cancellation events back to the processing queue. One consumer dispatches message kinds; avoid competing filtered consumers on the same queue.
4. A separate photo-AI queue invokes a Bedrock vision model on a resized image. The estimate used Nova Lite v1. Return bounded structured tags and record model/version and provenance. AI failure must not prevent a successfully processed image from being viewed. Do not infer names or family relationships from appearance. Editable tags and a short caption were suggested; only image tags are explicitly requested.
5. Track processing state in DynamoDB. Validate required output, dimensions, duration and checksums before publishing. Retain the compressed image and thumbnail, or playable video and poster, plus metadata. Clean up staged originals only after successful validation; retain failed inputs for recovery. If staging is versioned, a delete marker alone does not remove underlying bytes.
6. Browse by date and tags using DynamoDB key queries and pagination, intersecting candidates as appropriate rather than assuming an always-on search cluster. Deliver authorized thumbnails and full media through signed CloudFront access backed by private S3. Support range requests and grant renewal for video seeking.
7. Make workers idempotent, use bounded concurrency and dead-letter queues, and reconcile uncertain MediaConvert submissions and duplicate events before retrying.

**Fidelity tradeoff:** Discarding originals permanently loses original quality and potentially RAW, HDR, depth, Live Photo and other data. Exact output quality, accepted formats, size/duration limits and recovery window remain undecided. Strip GPS from served media while protecting any retained private metadata. Test orientation, portrait, variable-frame-rate and silent video; HDR/4K/60 fps and Live Photo components need explicit design beyond the baseline.

## UI

Three mockups were explored: a chronological **Timeline**, a **Calendar** contact sheet, and a tag-oriented **Story Explorer**. None was selected. The HTML mockups used synthetic media and simulated video; they were not a working app. Choose no final visual direction without checking with the user or the existing repo.

## Cost-model context

The user wanted understandable low, medium and high scenarios rather than manually changing every component. Each scenario should show **usage counts, AWS services, component costs and percentages together**. High was revised to twice medium's library, upload and viewing volumes, rather than the earlier extreme. Include AWS processing and staging; exclude a separate backup and video AI.

The November 2026 planning estimates below are illustrative, not guaranteed current prices. Recheck rates, account-wide free allowances, actual media characteristics and deployment region before using them for a decision. Starting libraries were assumed already processed; first import was a separate cost.

| Assumption | Low | Medium | High |
| --- | ---: | ---: | ---: |
| Existing processed photos | 5,000 | 25,000 | 50,000 |
| New photos per month | 100 | 500 | 1,000 |
| Existing processed videos | 100 | 500 | 1,000 |
| New videos per month | 5 | 25 | 50 |
| Thumbnail views per month | 5,000 | 30,000 | 60,000 |
| Full-photo opens per month | 500 | 3,000 | 6,000 |
| Video plays per month | 200 | 1,000 | 2,000 |
| Estimated monthly total with allowances | $0.28 | $1.34 | $2.65 |
| Estimated monthly total without shared allowance deductions | $1.19 | $3.90 | $7.27 |
| Initial-import core processing subtotal | $2.47 | $12.35 | $24.70 |

The model assumed 20 users, a 6 MiB photo compressed to approximately 1 MiB plus a 0.06 MiB thumbnail, and a 45-second, 150 MiB video compressed to approximately 25 MiB. These are modeling assumptions, not guaranteed output or chosen quality settings. Import subtotal excluded ongoing output storage, delivery and some operational costs. Shared allowances are account-wide and cannot be counted independently for each component. The older $38.83 high estimate was superseded.

For reference, the medium estimate attributed approximately $0.90 to S3 storage, $0.30 to MediaConvert, $0.02 to S3 requests, $0.01 to API/queues/events, $0.03 to DynamoDB, $0.07 to photo AI and $0.02 to auth/email/logs; other items were allowance-covered and rounding adjusted the displayed total. Verify current pricing before relying on it.

## Open decisions

- Final UI concept, name, framework, programming language, IaC tool, AWS region and deployment destination.
- Invitation, membership, roles, editing/deletion and recovery behavior.
- Exact compression quality, supported formats, upload limits, metadata retention and original-cleanup window.
- Whether to add captions, manual tag corrections, semantic search, comments, stories, voice recordings or approximate dates for older media. These were ideas, not confirmed scope.
- Any backup or point-in-time-recovery option would be a new decision, not part of the current cost baseline.

## Sources and status

Based on the November 3–4 conversation and `family-photo-album-plan.html` version 7, updated November 4 at 01:48 UTC. The later November 4 clarification that tags must describe each image ad hoc takes precedence. The HTML is a planning and cost prototype; it explicitly did not deploy AWS resources, access real media or implement the application.

Useful implementation references: [S3 pricing](https://aws.amazon.com/s3/pricing/), [MediaConvert pricing](https://aws.amazon.com/mediaconvert/pricing/), [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/), [Nova image input](https://docs.aws.amazon.com/nova/latest/userguide/modalities-image.html), [MediaConvert idempotency](https://docs.aws.amazon.com/mediaconvert/latest/apireference/idempotency.html), [CloudFront range requests](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RangeGETs.html), and [incomplete multipart-upload cleanup](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html).
