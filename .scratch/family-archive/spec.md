# Spec: Family Archive

Status: ready-for-agent

## Problem Statement

A family's photos and videos are scattered across phones, shoeboxes of scanned prints and individual accounts. No single place holds both older memories and new moments, so relatives can't easily browse the family's history by date, find "every photo at the lake", or add their own pictures. Older relatives, often the ones holding the scanned prints, find most photo apps cluttered and hard to read. The family also wants this to cost very little to run.

## Solution

The Family Archive is one private, shared Archive the whole family contributes to. Family members sign in, upload photos and videos from their phones, and browse everything on a Timeline grouped by year, then month, then day, newest first. Photos get AI tags describing what they show, which anyone can remove or add to with Family tags, and Tags power search. Items with no Capture date go to an Undated section, where someone who knows the exact date can set it. Family members can group items into Albums without ever risking deleting them.

The interface follows the chosen **Warm keepsake** direction: phone-first, cream paper tones, serif headings, photos shown as white-bordered prints, large legible text and word-labelled buttons. It's designed so grandparents can use it comfortably. Media is compressed and served by inexpensive AWS serverless infrastructure.

## User Stories

### Signing in and membership

1. As a family member, I want to sign in with my own account, so that only family can see the Archive.
2. As a family member, I want the Archive to refuse anyone who isn't a member, so that private family media stays private.
3. As a family member, I want to stay signed in on my phone, so that I don't have to sign in every time I open the app.

### Uploading

4. As a family member, I want to choose photos and videos from my phone in one step, so that adding to the Archive is easy.
5. As a family member, I want to see what I've selected before uploading, so that I can remove anything I picked by mistake.
6. As a family member, I want each selected item to show the date read from its file, so that I know where it will land on the Timeline.
7. As a family member uploading a scanned print, I want to be told when no date was found and be offered "Set date", so that the scan can go on the Timeline if I know when it was taken.
8. As a family member, I want to optionally put my upload into an Album, so that a batch from one event stays together.
9. As a family member, I want to be told that photos are tagged automatically after upload, so that I don't feel I have to tag everything myself.
10. As a family member, I want a clear message when a file is too large or of an unsupported type, so that I know why it wasn't accepted.
11. As a family member on a slow connection, I want large uploads to keep going reliably, so that I don't have to start over.
12. As a family member, I want to see when my uploads have finished processing, so that I know they're visible to everyone.
13. As a family member, I want a failed upload to tell me it failed rather than vanish, so that I can try again.

### Timeline

14. As a family member, I want the Timeline to show the newest items first, so that recent moments are easy to find.
15. As a family member, I want items grouped by year, then month, then day, so that I can find an event by when it happened.
16. As a family member, I want each month and day heading to show how many items it holds, so that I know how much is there.
17. As a family member, I want items from the same day kept together, so that a birthday or holiday reads as one event.
18. As a family member, I want videos marked with a play badge and their length, so that I can tell them apart from photos.
19. As a family member, I want the Timeline to load more as I scroll, so that a large Archive stays fast.
20. As a family member, I want to jump to a particular year, so that I can find old memories without endless scrolling.
21. As a family member, I want thumbnails to load quickly, so that browsing feels smooth even on a phone.

### Undated items

22. As a family member, I want a visible Undated section with a count, so that I know how many items still need dates.
23. As a family member, I want to browse Undated items, so that I can help date old scans.
24. As a family member, I want to set an exact Capture date on an Undated item, so that it moves onto the Timeline in the right place.
25. As a family member, I want the date field to accept only a full, exact date, so that the Timeline stays accurate.
26. As a family member, I want dates read from a camera file to be protected from being overwritten, so that nobody accidentally changes a correct date.

### Viewing an item

27. As a family member, I want to open a thumbnail and see the full, high-quality photo, so that I can enjoy it properly.
28. As a family member, I want to play a video and skip around in it, so that I can watch the part I care about.
29. As a family member, I want to see the full date an item was taken, so that I know when it happened.
30. As a family member, I want to see who added an item, so that I know whom to ask about it.
31. As a family member, I want to see which Albums an item is in, so that I can open related items.
32. As a family member, I want a large "Back to Timeline" button, so that I never get lost.

### Tags

33. As a family member, I want photos to get AI tags describing what they actually show, so that they can be found without anyone tagging by hand.
34. As a family member, I want AI tags visibly marked as added automatically, so that I know a person didn't choose them.
35. As a family member, I want to remove a wrong Tag, so that photos don't show up in the wrong searches.
36. As a family member, I want to add my own Family tag, such as "Cousins", so that I can describe what the AI can't know.
37. As a family member, I want the AI never to guess people's names or family relationships from their faces, so that photos aren't mislabelled in ways that could hurt or embarrass.
38. As a family member, I want a photo to stay viewable even if AI tagging fails, so that a tagging problem never hides a photo.
39. As a family member, I want removing a Tag to remove only that Tag, so that the item itself is never affected.

### Search

40. As a family member, I want to search by what's in the photo, such as "dog" or "beach", so that I can find items without knowing their date.
41. As a family member, I want to see how many items match, so that I know whether to narrow my search.
42. As a family member, I want suggested related Tags, so that I can try nearby searches with one tap.
43. As a family member, I want results shown as the same print thumbnails as the Timeline, so that the app feels consistent.
44. As a family member, I want to combine Tags, such as "beach" and "Cousins", so that I can find a specific moment.

### Albums

45. As a family member, I want to create an Album with a name, so that I can gather items from one trip or person.
46. As a family member, I want to add an item to an Album from the photo viewer, so that grouping takes one tap.
47. As a family member, I want one item to be in several Albums, so that "Grandpa" and "Lake trip 1978" can share a photo.
48. As a family member, I want to remove an item from an Album without deleting it, so that tidying up is safe.
49. As a family member, I want deleting an Album never to delete its items, so that nothing is lost when an Album is no longer wanted.
50. As a family member, I want an Albums tab listing every Album, so that I can browse collections others made.
51. As a family member, I want Album items to stay on the Timeline as well, so that Albums never hide anything.

### Accessibility and devices

52. As a grandparent, I want large, high-contrast text, so that I can read everything without zooming.
53. As a grandparent, I want buttons labelled with words and not just icons, so that I know what each one does.
54. As a grandparent, I want big tap targets, so that I don't hit the wrong thing.
55. As a grandparent, I want one obvious main action on each screen, so that I'm never unsure what to do next.
56. As a family member using a screen reader, I want photos, buttons and Tags properly labelled, so that I can use the app.
57. As a family member on a computer, I want a desktop Timeline with a wider grid, so that I can browse comfortably on a bigger screen.

### Privacy and cost

58. As a family member, I want location data removed from shared photos and videos, so that where we live isn't exposed.
59. As the family, we want the Archive to cost a few dollars a month or less at normal use, so that it's sustainable to keep running.
60. As a family member, I want media links that stop working once they expire, so that a forwarded link doesn't expose the Archive.

## Implementation Decisions

### Domain

- Terms follow the glossary: Archive, Album, Timeline, Capture date, Undated item, Tag, AI tag, Family tag.
- An Album is a grouping that references items. An item can be in any number of Albums, always remains in the Archive, and deleting an Album never deletes items.
- A Capture date is exact, never approximate. It comes from the file's metadata, or is entered by a family member only when the item is Undated. A date read from the file can't be overwritten through the app.
- The Timeline contains only items with a Capture date, newest first, grouped by year, then month, then day. Within a day, items are ordered by capture time when it's known. Undated items appear only in the Undated section.
- Each Tag records its provenance: AI tag (with model and version) or Family tag (with who added it). Any family member can remove any Tag or add a Family tag. Removing an AI tag must keep it from coming back on re-tagging.
- Videos never get AI tags.

### Modules

1. **Identity and membership:** Cognito sign-in. The API authorizes every request against family membership. How invitations and roles work is undecided (see Further Notes).
2. **Upload grants:** the API issues constrained, short-lived upload grants straight into private S3 staging. It validates size and type up front, supports multipart uploads for large files, and cleans up incomplete multipart uploads with a lifecycle rule.
3. **Processing pipeline:** a single processing queue invokes one consumer that dispatches on message kind. Avoid competing filtered consumers on the same queue.
   - **Photos:** compression in Lambda (Sharp) produces a compressed display image and a thumbnail. Before conversion, the pipeline extracts the Capture date, time offset, orientation and relevant private metadata. HEIC support needs a tested libheif-capable build.
   - **Videos:** a Lambda submits a MediaConvert job and returns without waiting. The baseline output is one 1080p/30 fps H.264 + AAC MP4 plus a poster frame. EventBridge routes completion, failure and cancellation events back to the processing queue.
   - **Publishing:** before publishing, the pipeline checks that the required outputs exist and validates dimensions, duration and checksums. Only then is the item visible. Staged originals are deleted only after successful validation, and failed inputs are kept for recovery. If staging is versioned, deletion must remove the underlying versions, not just add a delete marker.
   - Workers are idempotent, run with bounded concurrency and have dead-letter queues. Uncertain MediaConvert submissions and duplicate events are reconciled before any retry.
4. **Photo AI tagging:** a separate queue invokes a Bedrock vision model on a resized copy of the image. Nova Lite v1 was used for the cost estimate. The model returns bounded, structured, open-ended Tags, not picked from a fixed list. The prompt forbids names, identities and family relationships. A tagging failure never blocks viewing.
5. **Item store:** DynamoDB holds item records, processing state, Tags, Album membership and Capture dates.
6. **Browse and query:** the Timeline is read with DynamoDB key queries by year, month and day, paginated by cursor, plus an Undated listing and count. Tag search uses per-Tag key queries, intersecting candidates for multi-Tag searches. There is no always-on search cluster.
7. **Media delivery:** signed CloudFront access backed by private S3 serves thumbnails, display images, video and posters. It supports range requests and grant renewal so videos can be seeked. GPS data is stripped from all served media.
8. **Web client:** a phone-first thin client over the API, in the Keepsake design, plus a responsive desktop Timeline.

### API contract (behavioral)

- **Upload:** request a grant for each file (type and size validated), upload to staging, then the item appears once processing finishes. Clients can poll an item's processing state.
- **Timeline:** returns year, month and day groups with counts and item summaries (thumbnail access, kind, video duration), newest first, paged by cursor.
- **Undated:** the count and a paged list of Undated items.
- **Item detail:** display image or playable video access, Capture date, who added it, Tags with provenance, and the Albums it's in.
- **Tags:** add a Family tag, or remove any Tag.
- **Set Capture date:** accepted only for Undated items and only as a full exact date. Afterwards the item appears on the Timeline.
- **Search:** one or more Tags, returning the match count, paged results and related-Tag suggestions.
- **Albums:** create, list, view contents, add an item, remove an item, delete. Deleting removes only the grouping.

### UI (Warm keepsake)

- **Mockups:** a private claude.ai canvas (link in Further Notes), row A.
- **Palette:** cream ground, dark warm ink, terracotta accent with a sage alternative, muted text that passes 4.5:1 contrast.
- **Type:** Fraunces for headings, Atkinson Hyperlegible for body text. Body text is at least 17px and the smallest text 15px.
- **Thumbnails:** square images in white print borders with a soft shadow. Videos carry a play badge with their duration.
- **Navigation:** a bottom tab bar with labels: Timeline, Albums, Search, Upload. Tap targets are at least 44px.
- **Timeline screen:** the title, then a slim Undated banner with a count, then year, month (with count) and day (with count) headings over a 3-column grid of prints.
- **Photo viewer:** "Back to Timeline", the photo as a large print, the full date, "Added by", the Tags as chips (AI tags marked ✨, each with a remove ×, plus "+ Add a tag"), Album membership, and "Add to album" as the main button.
- **Search screen:** a labelled search field with a Search button, related-Tag chips, the result count and a grid of prints.
- **Upload screen:** a "Choose from this phone" button, the selected items with their dates ("Set date" on those with no date found), an optional Album picker, a note about automatic tagging, and "Upload N items".
- **Desktop:** a top navigation bar (Timeline, Albums, Search, Undated) with an Upload button, the Undated banner, then the same year, month and day headings over a wider grid.

## Testing Decisions

- **One seam: the family-facing HTTP API.** Tests send authenticated requests and assert on responses only, never on internal tables, queue messages or function internals.
- The processing workers run inside API-level tests. For example: request an upload grant, upload a fixture, let the pipeline run, then check that the item appears on the Timeline under the right day with its AI tags.
- Bedrock and MediaConvert are replaced by fakes at their client boundary. These are adapters, not extra seams. The fakes must be able to fail, time out and deliver duplicate events, so tests can show that a tagging failure still leaves the photo viewable and that duplicate completion events publish an item only once.
- Storage, queue and table dependencies use local stand-ins faithful enough to exercise pagination, idempotency and validation-before-publish.
- **A good test** describes behavior a family member would recognize, for example:
  - deleting an Album leaves its items on the Timeline
  - setting a date on an Undated item moves it onto the Timeline
  - a date read from a file can't be overwritten
  - a removed AI tag stays removed
  - non-members are refused
  - served media has no GPS data
- **Media fixtures:** cover orientation, portrait, HEIC, a file with no date, variable-frame-rate video and silent video.
- There are no UI-level tests in v1. The client stays thin, and visual review is against the Keepsake mockups.
- There is no prior art: the repo has no code yet.

## Out of Scope

- AI tagging of videos or video posters.
- A separate backup copy or point-in-time recovery. Either would be a new decision outside the cost baseline.
- Approximate dates such as "c. 1985" or "1980s".
- Captions, semantic search, comments, stories and voice recordings.
- Client-side compression and Rekognition.
- HDR, 4K, 60 fps and Live Photo handling beyond the 1080p/30 baseline.
- Editing items (deleting is covered below, added after launch).
- The Quiet gallery and Editorial UI directions.
- Deleting or changing any existing family media during migration or setup.

## Further Notes

- **Mockups (Keepsake row):** https://claude.ai/artifact/SzEX9s2rZ75AdakoC46LyF. Albums and Undated screens aren't mocked yet; follow the Keepsake patterns.
- **Source:** `family-photo-album-handoff.md`, plus the UI decisions made in the Nov 4–5 grilling session. Where they differ, this spec's UI section supersedes the handoff's.
- **Open decisions an agent must raise before building the affected part:**
  - framework, programming language, IaC tool, AWS region and where it's deployed
  - invitations, membership and roles
  - compression quality, accepted formats, upload size and duration limits (shown as [SIZE LIMIT] in the mockups), which metadata to keep, and how long to keep originals before cleanup
  - the app's final name ("Family Archive" is a placeholder)
- **Cost:** about $0.28, $1.34 and $2.65 a month for low, medium and high use with free allowances counted. These November 2026 figures are illustrative; recheck prices before deciding.
- **Fidelity tradeoff:** keeping only the compressed versions permanently loses original quality, RAW, HDR, depth and Live Photo data. That's accepted for the baseline.

## Addendum: deleting items (2026-11-05)

Decided with the user after launch:

- Only the uploader can delete an Item, and only once it is ready (`403 not_yours`, `409 not_ready`).
- Deleting moves it to Recently deleted. It is hidden from the Timeline, Undated, search and Albums; only the uploader can open it, with a Restore button.
- Restoring brings it back with the same Tags and Albums.
- 30 days after deletion a daily job deletes it for good: its files, Tag index entries and Album memberships. "Delete now" in Recently deleted does the same at once, after a confirmation.
- Deleting is done from the item's own page only. Selecting several at once is deferred.


## Addendum: live, partial search (2026-11-05)

- Results update as the user types, after a 250 ms pause. There is no Search button.
- Each comma-separated term matches the start of any word in a Tag: "nail", "salon" and "nail sal" all find "nail salon"; "ail" does not. Terms combine as AND.
- Index: one row per word-start of each Tag (`TW#…`, gsi1 `TAGWORDS`), prefix-queried. After deploying, rebuild it once for existing Items by invoking the Janitor with `{"task":"rebuild-tag-index"}`.
