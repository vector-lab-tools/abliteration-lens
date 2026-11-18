# Abliteration Lens and bench-kit

Written for David M. Berry. bench-kit has not been changed, and no bench's kit pointer has been moved.

## What was decided

The reading side of Abliteration Lens is not a bench-kit bench. A bench reads fixed versions fetched from a repository and annotates them through Hypothesis. Abliteration Lens drives a model: it re-runs as a knob moves, streams tokens, and rescores texts under a second model. Those needs belong to a local server and a page of its own.

The outputs are shaped so that a bench can read them later:

- Each run gives two **versions**: the baseline text and the bent text. A version is one file of numbered lines (split at newlines, as Before and after numbers them), with the run's recipe attached.
- **Descent** uses bench-kit's terms from `versionlist.js`:
  - `parent`: the bent version's parent is its own baseline. Where the run was made after opening another run on the Bench, its parent is that run's bent version.
  - `witness`: a regeneration of a recipe (or, later, a reseed) is a witness of the run it repeats, not a step of its own.
- Annotations use LLMbench's six types and are anchored to a side (baseline or bent) and a line number, so they map onto a bench's file-and-line anchors.

Variorum ▸ Export bench-kit bundle writes these as `abliteration-lens.benchkit-bundle.v1` (bundles exported before 0.1.15 say `abliterton-lens.benchkit-bundle.v1`; the two are the same format):

```json
{
  "format": "abliteration-lens.benchkit-bundle.v1",
  "tool": {"name": "Abliteration Lens", "version": "0.1.0"},
  "versions": [{"id": "<run>-bent", "label": "...", "date": "...", "summary": "<chain text>",
                "files": [{"name": "<run>-bent.txt", "role": "text", "lines": ["...", "..."]}],
                "recipe": {}}],
  "parent": {"<run>-bent": {"id": "<run>-baseline"}},
  "witness": {"<regenerated run>-bent": {"id": "<run>-bent"}}
}
```

## What a bench would need from the kit to read this directly

None of these is a request to change the kit now; they are what a "generated-text bench" type would need, for `docs/bench-types.md` if one is made.

1. **Versions from a JSON bundle.** `SWVersionList` takes `versions`, `parent`, `witness` and `also` as JS objects from `js/versions.js`. A bench would need either a small build step that writes `js/versions.js` and the text files from the bundle, or a reader that takes the bundle as it is. The first needs nothing from the kit.
2. **A line that is a paragraph.** Generated text has few newlines, so a "line" is often a paragraph of several sentences. The prose-bench reader would serve; Book's spans would be whole lines.
3. **The recipe as a version record field.** `version.js` shows a version's record; a bench would want the recipe shown there (model, revision hash, seed, sampler, chain) and its JSON offered for download. The bench's own rows (`SW.BENCH.version`) can do this without a kit change.
4. **Compare across many witnesses.** `compare.js` collates versions line by line. Collation of bent texts against a baseline works as it is; a view that sets one baseline against many bent texts at once (a dose sweep) would be a lens, the bench's own (`SW.BENCH.lenses`).
5. **No per-token data.** A bench would show the text only. Per-token probabilities, the divergence point and the control band stay in Abliteration Lens and its JSON export.
