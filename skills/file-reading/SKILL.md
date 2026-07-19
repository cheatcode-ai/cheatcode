---
name: file-reading
description: "Use this skill when you need to read a file whose content is NOT already in your context — you only know its path. This skill is a router: it tells you which tool to use for each file type (pdf, docx, xlsx, csv, json, images, archives, ebooks) so you read the right amount the right way instead of blindly running cat on a binary. Do NOT use this skill if the file content is already visible in your context — you already have it."
category: Research & Docs
tags: files, inspection, extraction, documents
compatibility: Requires the file-inspection and document runtimes bundled in the sandbox snapshot.
---

## Dependency Check

Before using this skill, first verify that any external commands, libraries, or packages it depends on are installed in the current environment.
If a required dependency is missing, install it first in the appropriate scope before continuing.

# Reading Files

## Why this skill exists

When a user asks about a file in their project or workspace, you often
only know the path — the content is not in your context. You must go
read it.

The naive approach — `cat whatever` — is wrong for most non-text files:

- On a PDF it prints binary garbage.
- On a 100MB CSV it floods your context with rows you will never use.
- On a DOCX it prints the raw ZIP bytes.
- On an image it does nothing useful at all.

This skill tells you the right first move for each type, and when to
hand off to a deeper skill.

## General protocol

1. **Look at the extension.** That is your dispatch key.
2. **Stat before you read.** Large files need sampling, not slurping.
   ```bash
   stat -c '%s bytes, %y' report.pdf
   file report.pdf
   ```
3. **Read just enough to answer the user's question.** If they asked
   "how many rows are in this CSV", don't load the whole thing into
   pandas — `wc -l` gives a fast approximation.
4. **If a dedicated skill exists, go read it.** The table below tells
   you when.

## Dispatch table

| Extension | First move | Dedicated skill |
|-----------|------------|-----------------|
| `.pdf` | Content inventory (see PDF section) | `pdf-reading` skill |
| `.docx` | `pandoc` to markdown | `docx` skill |
| `.doc` (legacy) | Convert to `.docx` first — pandoc cannot read it | `docx` skill |
| `.xlsx`, `.xlsm` | `openpyxl` sheet names + head | `xlsx` skill |
| `.xls` (legacy) | `pd.read_excel(engine="xlrd")` — openpyxl rejects it | `xlsx` skill |
| `.ods` | `pd.read_excel(engine="odf")` — openpyxl rejects it | `xlsx` skill |
| `.pptx` | `python-pptx` slide count | `pptx` skill |
| `.ppt` (legacy) | Convert to `.pptx` first — python-pptx rejects it | `pptx` skill |
| `.csv`, `.tsv` | `pandas` with `nrows` | — (below) |
| `.json`, `.jsonl` | `jq` for structure | — (below) |
| `.jpg`, `.png`, `.gif`, `.webp` | Read the image file directly | — (below) |
| `.zip`, `.tar`, `.tar.gz` | List contents, do **not** auto-extract | — (below) |
| `.gz` (single file) | `zcat \| head` — no manifest to list | — (below) |
| `.epub`, `.odt` | `pandoc` to plain text | — (below) |
| `.rtf` | `pandoc` or LibreOffice via docx skill | — (below) |
| `.txt`, `.md`, `.log`, code files | `wc -c` then `head` or full `cat` | — (below) |
| Unknown | `file` then decide | — |

---

## PDF

**Never** `cat` a PDF — it prints binary garbage.

Quick first move — get the page count and check if text is extractable:

```bash
pdfinfo report.pdf
pdftotext -f 1 -l 1 report.pdf - | head -20
```

Then peek at the text content:

```python
from pypdf import PdfReader
r = PdfReader("report.pdf")
print(f"{len(r.pages)} pages")
print(r.pages[0].extract_text()[:2000])
```

For anything beyond a quick peek — figures, tables, attachments,
forms, scanned PDFs, visual inspection, or choosing a reading strategy
— use the `pdf-reading` skill.

For PDF creation, merging, splitting, or form filling, use the `pdf` skill.

---

## DOCX / DOC

The `docx` skill covers editing, creating, tracked changes, images.
Read it if you need any of those. For a quick look:

```bash
pandoc memo.docx -t markdown | head -200
```

Legacy `.doc` (not `.docx`) must be converted first — see the `docx`
skill.

---

## XLSX / XLS / spreadsheets

The `xlsx` skill covers formulas, formatting, charts, creating. Read
it if you need any of those. For a quick look at `.xlsx` / `.xlsm`:

```python
from openpyxl import load_workbook
wb = load_workbook("data.xlsx", read_only=True)
print("Sheets:", wb.sheetnames)
ws = wb.active
for row in ws.iter_rows(max_row=5, values_only=True):
    print(row)
```

`read_only=True` matters — without it, openpyxl loads the entire
workbook into memory, which breaks on large files. Do not trust
`ws.max_row` in read-only mode: many non-Excel writers omit the
dimension record, so it comes back `None` or wrong.

**Legacy `.xls`** — openpyxl raises `InvalidFileException`. Use:

```python
import pandas as pd
df = pd.read_excel("old.xls", engine="xlrd", nrows=5)
```

**`.ods` (OpenDocument)** — openpyxl also rejects this. Use:

```python
import pandas as pd
df = pd.read_excel("data.ods", engine="odf", nrows=5)
```

---

## PPTX

```python
from itertools import islice
from pptx import Presentation
p = Presentation("deck.pptx")
print(f"{len(p.slides)} slides")
for i, slide in enumerate(islice(p.slides, 3), 1):
    texts = [s.text for s in slide.shapes if s.has_text_frame]
    print(f"Slide {i}:", " | ".join(t for t in texts if t))
```

`p.slides` is not subscriptable — `p.slides[:3]` raises
`AttributeError`. Use `islice` or `list(p.slides)[:3]`.

**Legacy `.ppt`** — python-pptx only reads OOXML. Convert to `.pptx`
first via LibreOffice; see the `pptx` skill for the sandbox-safe
`scripts/office/soffice.py` wrapper (bare `soffice` hangs because
the seccomp filter blocks the `AF_UNIX` sockets LibreOffice uses
for instance management).

For anything beyond reading, use the `pptx` skill.

---

## CSV / TSV

**Do not** `cat` or `head` these blindly. A CSV with a 50KB quoted cell
in row 1 will wreck your `head -5`. Use pandas with `nrows`:

```python
import pandas as pd
df = pd.read_csv("data.csv", nrows=5)
print(df)
print()
print(df.dtypes)
```

Approximate row count without loading:

```bash
wc -l data.csv
```

Full analysis only after you know the shape:

```python
df = pd.read_csv("data.csv")
print(df.describe())
```

TSV: same, with `sep="\t"`.

---

## JSON / JSONL

Structure first, content second:

```bash
jq 'type' data.json
jq 'if type == "array" then length elif type == "object" then keys else . end' data.json
```

Then drill into what the user actually asked about.

JSONL (one object per line) — do **not** `jq` the whole file; work line
by line:

```bash
head -3 data.jsonl | jq .
wc -l data.jsonl
```

---

## Images (JPG / PNG / GIF / WEBP)

Use the Read tool to view image files directly — it supports jpeg/jpg,
png, gif, and webp formats.

If you need to **process** the image programmatically:

```python
from PIL import Image
img = Image.open("photo.jpg")
print(img.size, img.mode, img.format)
```

For OCR on an image (text extraction):

```python
import pytesseract
print(pytesseract.image_to_string(img))
```

---

## Archives (ZIP / TAR / TAR.GZ)

**List first. Extract never — unless the user explicitly asks.**
Archives can be huge, contain path traversal, or nest forever.

```bash
unzip -l bundle.zip
tar -tf bundle.tar
```

GNU tar auto-detects compression — `tar -tf` works on `.tar`,
`.tar.gz`, `.tar.bz2`, `.tar.xz` alike.

If the user wants one file from inside, extract just that one:

```bash
unzip -p bundle.zip path/inside/file.txt
```

**Standalone `.gz`** (not a tar) compresses a single file — there is
no manifest to list. Just peek at the decompressed content:

```bash
zcat data.json.gz | head -50
```

---

## EPUB / ODT

```bash
pandoc book.epub -t plain | head -200
```

For long ebooks, pipe through `head` — you rarely need the whole thing
to answer a question.

---

## RTF

Try pandoc first (RTF reader added in 3.1.7):

```bash
pandoc notes.rtf -t plain | head -200
```

If you see `Unknown input format rtf`, convert via LibreOffice using
the sandbox-safe wrapper — see the `docx` skill for
`scripts/office/soffice.py`.

---

## Plain text / code / logs

Check the size first:

```bash
wc -c app.log
```

- **Under ~20KB**: `cat` is fine.
- **Over ~20KB**: `head -100` and `tail -100` to orient. If the user
  asked about something specific, `grep` for it. Load the whole thing
  only if you genuinely need all of it.

For log files, the user almost always cares about the end:

```bash
tail -200 app.log
```

---

## Unknown extension

```bash
file mystery.bin
xxd mystery.bin | head -5
```

`file` identifies most things. `xxd` head shows magic bytes. If `file`
says "data" and the hex doesn't match anything you recognize, ask the
user what it is instead of guessing.
