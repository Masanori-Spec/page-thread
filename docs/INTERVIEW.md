# Portfolio narrative and validation questions

## What I built

PageThread takes a known print-page boundary list and connects it to an existing EPUB. It exposes repeated phrase candidates, requires explicit editorial choices and produces an EPUB plus a reproducible decision/verification packet. The core edits original XML by insertion offsets, so unrelated prose, markup and resources stay intact.

## Engineering tradeoffs to explain

The difficult part is identity and preservation, not generating a navigation list. Filename order is not spine order. One phrase can appear repeatedly, Unicode code points differ from UTF-16 indexes, and a phrase can span ordinary inline markup. A useful receipt must point into the original source and bind all decisions to its hash.

The parser has explicit ZIP/XML, text and work bounds. Unsupported structures remain in the book but are excluded from matching. The UI keeps committed state separate from pending asynchronous imports and rejects stale results after cancel/reset. Tests include Buffer/view ownership so the Node API cannot mutate a caller's original bytes.

The separate Python verifier reconstructs the permitted output and also removes only the declared additions to recover the original. Mutation tests refresh hashes before verification, so valid hashes cannot hide changed prose or resources. Official EPUBCheck is a second, different check. Neither establishes that the editor chose the right paper edition or phrase.

## Questions for a future, permission-cleared interview

- When do you receive an EPUB without its original layout project?
- How are print-page starts currently supplied, and how often are the same words repeated?
- Which structure types make a phrase search insufficient?
- What evidence would let a second editor review your decisions quickly?
- Which reading systems must the exported file work in?
- Would mapping setup and exception handling save time compared with your existing EPUB editor?

No interviews, outreach, usage claims or commercial commitments have been made. Existing page-list and layout tools may already be sufficient for many editors; the proposed value is the alignment and handoff workflow.
