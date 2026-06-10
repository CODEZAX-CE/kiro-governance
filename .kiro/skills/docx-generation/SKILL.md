# SKILL: Markdown to DOCX Conversion

## Overview
Convert any Markdown file to a formatted Word (.docx) document using pandoc.

## Tool
`pandoc` (available at `/usr/bin/pandoc`, version 2.9.2.1)

## Basic Usage

```bash
pandoc input.md -o output.docx
```

## With Reference Document (Default — Landscape)
Always use the landscape reference doc. It provides more horizontal space for tables and works well for all document types:

```bash
pandoc input.md --reference-doc=.kiro/skills/docx-generation/references/reference-landscape.docx -o output.docx
```

## Standard Conversion Commands

### Single file
```bash
pandoc docs/technical-scope-understanding.md \
  --reference-doc=.kiro/skills/docx-generation/references/reference-landscape.docx \
  -o output/technical-scope-understanding.docx
```

### Multiple files merged into one docx
```bash
pandoc docs/file1.md docs/file2.md \
  --reference-doc=.kiro/skills/docx-generation/references/reference.docx \
  -o output/combined.docx
```

## Output Location
Always save generated .docx files to `output/` relative to the project root (create if it doesn't exist).

## Table of Contents
Add `--toc` flag to include a table of contents:
```bash
pandoc input.md --toc --reference-doc=... -o output.docx
```

## Notes
- Markdown tables render as Word tables
- Code blocks render as monospace
- Emoji in headings (🔴🟡🟢) render correctly
- If no reference.docx exists yet, run without `--reference-doc` first, then the output can be styled manually

## Pre-Conversion Checklist (MANDATORY — run before every pandoc call)

Before converting any `.md` to docx, scan the source file and fix all of the following. Do not run pandoc until all items are resolved.

1. **Tight bullet lists** — add a blank line between every list item
2. **Bullets after a bold heading** — add a blank line between the heading and the first bullet
3. **Bullets after a code block** — add a blank line between the closing ``` and the first bullet
4. **Nested bullets** — ensure 4-space indent with blank lines between items
5. **Tables with >8 columns** — split into two tables or remove lower-priority columns

Fix the `.md` file first, then run pandoc.

---

## Markdown Formatting Rules for Word Output

These rules MUST be applied when writing or editing any markdown file intended for docx conversion. Pandoc's Word renderer behaves differently from GitHub/browser markdown.

### Rule 1: Bullet lists — always add blank lines between items
Word collapses tight lists (no blank lines) into a single paragraph. Always use loose lists:

```markdown
❌ Wrong — renders as one line in Word:
- Item one
- Item two
- Item three

✅ Correct — each item on its own line in Word:
- Item one

- Item two

- Item three
```

### Rule 2: Bullet lists after bold headings — add blank line after the heading
```markdown
❌ Wrong:
**Key points:**
- Point one
- Point two

✅ Correct:
**Key points:**

- Point one

- Point two
```

### Rule 3: Bullet lists after code blocks — always add a blank line
Pandoc sometimes merges the first bullet into the preceding code block paragraph.
```markdown
❌ Wrong:
```
code block
```
- First bullet

✅ Correct:
```
code block
```

- First bullet
```

### Rule 4: Nested bullets — use 4-space indent, with blank lines
```markdown
- Parent item

    - Child item one

    - Child item two
```

### Rule 5: Tables — keep column count ≤ 6 for portrait, ≤ 8 for landscape
Wide tables with many columns get squashed even in landscape. If a table exceeds these limits, split into two tables or remove lower-priority columns.
