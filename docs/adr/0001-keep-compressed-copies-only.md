# Keep compressed copies only; delete originals after processing

Status: accepted (2026-11-05)

## Decision

The Archive stores only processed copies: photos as a 2048px JPEG plus a 400px thumbnail, videos as H.264 MP4 at 30 fps, at most 1080p (short side scaled down to 1080, never up; QVBR 7, 8 Mbps cap) plus a poster. The uploaded original is deleted once those copies are verified. Failed uploads keep their original in staging for 30 days, for recovery.

## Why

Compressed copies are enough for viewing on phones, and storing them is cheap and simple. The family chose this for now.

## Considered

Keeping originals in S3 Glacier Instant Retrieval, at about $4/TB per month plus about $0.03/GB to read them back, with a "Download original" button. Deferred, not rejected. Revisit if the family wants prints, re-editing, or a full-quality backup. Originals that have already been deleted cannot be recovered.
