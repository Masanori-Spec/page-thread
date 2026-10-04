# Demo walkthrough

The original synthetic *Field Notes Along the River* is a small EPUB with three spine documents in `zz-preface`, `mm-trail`, `aa-river` order. Filename sorting would produce the wrong order.

1. Load the sample. The inspector reports three spine documents, 13 supported text blocks and three excluded blocks (ruby, hidden and CDATA)
2. Search the eight supplied rows. “A shared beginning” has four candidates: one in the preface, two in one paragraph and one in the last chapter
3. Inspect candidate 3 for page 2. It is the second occurrence in the woodland paragraph; do not accept the first matching string
4. Apply the known sample selections, then review all eight boundaries in spine order
5. The italic phrase spans ordinary inline markup; the ampersand phrase crosses an entity and strong emphasis; another offset falls after an emoji; the closing phrase starts after a comment and before a PI
6. Export EPUB, mapping, receipt and HTML report. The original book is unchanged. The output adds eight markers, one page list, three metadata entries and the explicit modified timestamp
7. Reset, reopen the same original file and restore the mapping. Another input hash is rejected

For deterministic command-line output:

```sh
node scripts/fixture-output.mjs
npm run test:oracle
npm run test:mutations
```

Files appear in `tests/generated/`. The independently authored `expected-selection.json` contains literal original text-node identities and offsets. The final fixture/output hashes are in [VERIFICATION.md](VERIFICATION.md).

The sample's page labels are editorial test data. They are not derived from a real printed edition and do not demonstrate reader compatibility or actual print alignment.
