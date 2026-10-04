# Research and bounded product case

Researched 2026-10-04. PageThread is for an editor who has an EPUB and a list of known print-edition page starts, but does not have the layout project that generated the book. The concrete work is aligning quoted page starts, resolving repeated text and handing off an auditable file.

## Standards profile

[EPUB 3.3 navigation](https://www.w3.org/TR/epub-33/#sec-nav-pagelist) defines page-list navigation. The [W3C accessibility techniques](https://www.w3.org/TR/epub-a11y-tech-11/#page-navigation) describe page markers and source metadata. PageThread uses empty XHTML spans with both EPUB and DPUB-ARIA semantics, exact labels and a flat page list. It declares only the generated page-navigation features, not overall accessibility conformance.

The current techniques recommend `pageBreakSource` and explicitly note EPUBCheck support. The [EPUB 3.4 publication of 2026-10-02](https://www.w3.org/TR/2026/CRD-epub-34-20261002/) is a Candidate Recommendation Draft. The [official EPUBCheck 5.4.0 release](https://github.com/w3c/epubcheck/releases/tag/v5.4.0) checks that current profile. We document these dates and scope rather than presenting 3.4 as a final standard.

## Existing tools

| Existing option | Existing capability | PageThread's bounded distinction |
|---|---|---|
| [Sigil PageList plugin](https://www.mobileread.com/forums/showthread.php?t=265237) | Creates navigation from already-inserted markers; its author warns about replacing lists | Explicit alignment and review before marker insertion; existing lists are rejected |
| [EPUBLib page-list support](https://epublib.readthedocs.io/en/stable/epublib.html) | Builds page lists from pagebreak elements | Starts with editor-provided phrases and preserves a decision record |
| [epubpaginator](https://github.com/tthkbw/epub_pager) | Supports approximate positions based on word/page or total-page settings | Never estimates pagination; every boundary is editor supplied |
| [CircularFLO](https://www.circularsoftware.com/kb/topic/section-labels-and-page-markers) | Creates real page markers/navigation from InDesign | Works on an existing eligible EPUB without the layout-source project |

These comparisons support a workflow distinction, not novelty or unmet demand. A page-list generator alone would duplicate existing work.

## Product decisions

- Scope follows OPF relationships and spine order, not filenames or chapter titles
- Repeated candidates stay explicit; unique candidates still require selection
- XML whitespace is the only matching normalization, so near-matches cannot silently move an editorial boundary
- Existing pagination is rejected in v1, avoiding destructive replacement semantics
- The preservation oracle removes only declared additions and recovers the original structure/text
- Saved mappings bind to one exact input; changes to the book require new decisions
- The app never renders or executes imported XHTML/CSS/assets

A useful next study would ask editors to bring permission-cleared page-boundary lists, measure which quotes need disambiguation or cannot be mapped, and compare the time/error rate with their current tool. No customer contact or demand validation has been performed.
