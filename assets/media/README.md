# EEAMS Media Folder

Use one folder per year for concert media. Most years will have one concert, marked as `concert1`. If a year has more than one concert, use `concert2`, `concert3`, and so on.

```text
assets/media/concerts/2026/
  2026-concert1-poster.jpg
  2026-concert1-program-book.pdf
  2026-concert1-photo1.jpg
  2026-concert1-photo2.jpg

  2026-concert2-poster.jpg
  2026-concert2-program-book.pdf
```

Recommended rule: use lowercase English filenames, four-digit years, and short concert IDs.

In `data/archive.csv`, set:

```text
date,slug
2026-09-15,concert1
```

The website will look for:

```text
assets/media/concerts/2026/2026-concert1-program-book.pdf
assets/media/concerts/2026/2026-concert1-poster.jpg
```

Keep audio and video files as external media links when possible.

## Publication rules

- Keep concert IDs stable after publication. Do not renumber older concerts when adding records.
- Archive CSV contains one row per work. Use the same date and slug for all works in a concert; work_order follows the program.
- Existing poster and program-book files appear as links automatically. Missing files are hidden.
- Concert photos use consecutive names from `photo1.jpg`. When `photo1.jpg` exists, the archive shows one Photos link and opens every consecutively numbered photo as a gallery. Do not leave gaps in the numbering.
- A gallery supports up to 20 photos per concert. Four to eight selected images are recommended. CSV photo columns are not required.
- Prepare gallery images as JPEG files with a long edge of 2000-2400 pixels and approximately 0.3-0.8 MB per image.
- Education media belong in assets/media/education/YYYY/. Use YYYY-MM-DD-lecture1-poster.jpg (or workshop1) and enter the relative path in the materials column of education.csv.
- Education poster links open in the same media viewer as concert materials, with a download link.
- Use lowercase filenames. Keep original high-resolution materials outside the published website.
- Posters imported in September 2026 use JPEG, a maximum long edge of 2400 pixels, and approximately 0.3-0.8 MB per image. Program books already below 5 MB were preserved unchanged.
- Leave unverified English names and unknown instrumentation blank; bilingual fields use the existing fallback. Do not invent source information.
