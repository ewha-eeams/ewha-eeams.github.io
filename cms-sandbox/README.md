# EEAMS CMS trial

This directory contains public content copies for Pages CMS testing on branch `cms-pilot-20261026`.

- Use `기존 공연 수정 · 사본` to select one of the three copied concerts. Existing dates and identifiers stay fixed in this review phase.
- Use `새 공연 초안` to create an entry in `cms-sandbox/drafts/`. Draft filenames/UUIDs are generated automatically; users do not enter a technical filename or public concert identifier.
- Input order is basic concert information, works, then optional poster/PDF/photos. English fields are optional. A new concert starts with one blank work.
- CMS draft identifiers are independent of the public `YYYY-concertN` mapping. Assigning public identifiers, media naming/optimization, preview and publication remain later steps.
- `cms-sandbox/data/archive.csv` is the raw CSV compatibility-test copy. The hosted editor currently shows code rather than a table.
- Saving the JSON form does not update the CSV or publish the website. Conversion/review/publishing is not connected yet.
- Upload media under `cms-sandbox/media/concerts/YYYY/`.
- Keep filenames `YYYY-concertN-poster.jpg`, `YYYY-concertN-program-book.pdf` and `YYYY-concertN-photo1.jpg`.
- Do not merge this trial branch into `main`.
- Live website files and Google booking services are unchanged.

## Verified 2026-10-27

- CSV save/restore preserved 27 rows, blank cells, quoted commas and embedded newlines.
- Structured form save/restore preserved 8 works and optional empty values when converted to the existing CSV schema.
- JPG (314,926 bytes) and small PDF (110,102 bytes) uploaded and attached successfully; uploaded bytes matched the source copies.
- A 4,600,393-byte PDF did not save through the hosted CMS. Request size is a suspected cause, not a confirmed HTTP diagnosis. The full original PDF remains intact in the copied year folder.
- Disposable upload fixtures and edited form values were restored/removed after verification; history retains the trial evidence.
- Do not treat this as production CMS acceptance. Large-file upload, preview and reviewed publication remain to be implemented.
