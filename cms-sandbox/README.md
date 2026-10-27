# EEAMS CMS trial

This directory contains public content copies for Pages CMS testing on branch `cms-pilot-20261026`.

- Use `기존 공연 수정 · 사본` to select one of the three copied concerts. Existing dates and identifiers stay fixed in this review phase.
- Use `새 공연 초안` to create an entry in `cms-sandbox/drafts/`. Draft filenames/UUIDs are generated automatically; users do not enter a technical filename or public concert identifier.
- Input order is basic concert information, works, then optional poster/PDF/photos. English fields are optional. Add at least one work before saving; the editor provides an Add an item button.
- CMS draft identifiers are independent of the public `YYYY-concertN` mapping. Assigning public identifiers, media naming/optimization and publication remain later steps. New concert previews use temporary `YYYY-draft-UUID` identifiers.
- `cms-sandbox/data/archive.csv` is the raw CSV compatibility-test copy. The hosted editor currently shows code rather than a table.
- Saving the JSON form does not update the CSV or publish the website. Conversion/review/publishing is not connected yet.
- Use [자료 업로드 안내](https://app.pagescms.org/ewha-eeams/ewha-eeams.github.io/cms-pilot-20261026/file/upload_guide) for attachment steps. Files over 3 MB use the linked GitHub web uploader, then Select and Save in the CMS. Keep each trial file within 20 MB and use a unique filename.
- Original copied media remain under `cms-sandbox/media/concerts/YYYY/`. Public filenames `YYYY-concertN-poster.jpg`, `YYYY-concertN-program-book.pdf` and `YYYY-concertN-photo1.jpg` will be assigned/preserved during the later publication mapping step, not by guessing a concert number for a new draft.
- Do not merge this trial branch into `main`.
- Live website files and Google booking services are unchanged.

## Saved-draft preview

- Open **홈페이지 미리보기** in the CMS sidebar, then follow its local preview link. It reads saved content from this branch; it cannot read unsaved form values or publish changes.
- Local URL: http://127.0.0.1:8920/outputs/cms-trial-20261026/cms-sandbox/preview/index.html
- After CMS Save, click **저장된 초안 다시 불러오기** in the preview. Select a copied concert or new draft and inspect the current design at desktop/390px phone widths. All data and attachments are pinned to the same saved GitHub commit.
- This step uses the current computer's local preview server. A shared preview host for other computers or physical phones is not configured. No booking scripts or Google service calls are included.
- Public archive HTML, renderer and styles are reused without editing them. Selected CMS PDF/poster/photo paths take precedence, including explicit empty attachments. Missing media and failed fetches are shown clearly.

## Verified 2026-10-27

- CSV save/restore preserved 27 rows, blank cells, quoted commas and embedded newlines.
- Structured form save/restore preserved 8 works and optional empty values when converted to the existing CSV schema.
- JPG (314,926 bytes) and small PDF (110,102 bytes) uploaded and attached successfully; uploaded bytes matched the source copies.
- A 4,600,393-byte PDF did not save through the hosted CMS. Request size is a suspected cause, not a confirmed HTTP diagnosis. The full original PDF remains intact in the copied year folder.
- The full 4,600,393-byte PDF then uploaded through GitHub web upload to this branch, appeared in CMS Select and saved with a poster (314,926 bytes) and a photo (287,168 bytes) in a disposable concert draft. Reload preserved all three attachment paths; all uploaded bytes matched originals. The GitHub PDF view displayed the document, and both images loaded at original dimensions.
- A read-only CMS upload guide links to the trial branch uploader in a new tab. This is a working alternate upload route; it does not fix or expand Pages CMS's native Upload limit. The 20 MB trial policy is not a claim that a 20 MB file was tested.
- Disposable upload fixtures and edited form values were restored/removed after verification; history retains the trial evidence.
- Saved CMS draft preview was verified with a disposable new concert, two reordered works, a year-only date, blank optional values, PDF, poster and photo. The fixture is removed after verification; existing copies remain intact.
- Do not treat this as production CMS acceptance. Shared preview hosting and reviewed publication remain to be implemented.
