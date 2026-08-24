---
'paperlab': minor
---

Publish `stageBanner`, and carry a stage's pictures through its export.

`<PaperStageScene>` has accepted an `images` array all along, but
`StageExportInput` had no way to say so — a stage built out of pictures
exported as a stage of blank banners, silently. `images` now travels, and
`exportableImages` decides how.

An uploaded picture lives as a data URL, and pasting a hundred kilobytes of
base64 into a source file is not an export. So an upload becomes a placeholder
path — the right number of them, in the right order — and the snippet says
that is what happened. A referenced URL is already something the receiver can
fetch, so it travels verbatim and gets no apology. Emitting nothing was the
other option and it is the worst one: the reader gets blank banners and no clue
that the pictures were the point.

`stageBanner` is the sheet a stage hangs when the caller does not name one. It
is exported because it is the base anyone RESHAPING a banner has to start from
— a wider drop wants this stock, this grain and this drape at different
dimensions, and rebuilding from the schema defaults instead gives a sheet of
printer paper with no fold in it. A second copy of those numbers in a caller is
a copy free to drift from the one the scene actually falls back to.
