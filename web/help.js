// Abliteration Lens. Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// The Help box's topics: what each part of the bench, each intervention and each reading surface
// does, in plain terms. Each topic has a group (the contents list), a one-line summary, its text,
// and where it has one, a section on the Lens site or the VAU site to read more.
"use strict";
(() => {
  const SITE = "https://vector-lab-tools.github.io/abliteration-lens/";
  const VAUSITE = "https://vector-lab-tools.github.io/vector-abliteration-units/";
  // The units: listed from their manifests (units.js). Each line opens to the same help as the
  // unit's help button on its strip, drawn by the same code (Boxes.unitHelpBody), so there is one text.
  const VAU = window.VAU || { units: [], errors: [] };
  const UNIT_INTRO = `<p class="hb-unitintro">These are <b>Vector Abliteration Units</b>: each is one Python file whose manifest says what it does and what its parameters are. The help button (<b>?</b>) after a unit's name on its strip opens its help: what it does, an animated figure on example texts, and its parameters. A control that applies only under another setting is dimmed while it does not: vAbliterate's Peak, Width and Edge while its Shape is flat. The same help opens here under each unit; the <a href="${VAUSITE}units.html" target="_blank" rel="noopener">VAU units page ↗</a> has them all.</p>`;
  const METER = '<span class="meterbadge" title="A meter: it reads the model and leaves it unchanged">meter</span>';     // as on a meter's strip
  const unitRow = (u) => `<details class="hb-unit" data-unit="${u.id}"><summary><b>${u.title}</b>${u.category === "meter" ? " " + METER : ""} <code>${u.example || u.id}</code><span>${u.what}.</span>${u.source === "builtin" ? "" : " <i>From data/units, not built in.</i>"}</summary><div class="hb-unit-body"></div></details>`;
  const UNIT_LIST = (cat) => `<div class="hb-units">${VAU.units.filter((u) => u.category === cat).map(unitRow).join("")}</div>`;
  const UNIT_ONE = (id) => `<div class="hb-units">${VAU.units.filter((u) => u.id === id).map(unitRow).join("")}</div>`;
  // a list of controls or modes: [term, description] pairs
  const dl = (rows) => `<dl class="hd">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const finding = (html) => `<div class="hb-finding"><b>A finding from the build.</b> ${html}</div>`;

  const T = [
    // ------------------------------------------------------------ Getting started
    { g: "Getting started", t: "What the bench does", site: "#what",
      s: "A model on this machine, bent while it writes, beside the same model unbent.",
      b: `<p>Abliteration Lens loads an open-weight language model on this machine and changes how its forward pass runs while it writes. The text it then produces is set beside the text the unchanged model writes from the same prompt with the same seed.</p>
      <p>The change is a <b>chain</b> of interventions, worked from the first line to the last. Order matters wherever two strips touch the same part of the model.</p>
      ${dl([["Original", "the unchanged run."], ["Diverged", "the run through the chain. The seed, the sampler and the code path are the same, so the chain is the only difference between them."]])}
      <p>To start: load a model in the Instrument at the foot of the window, add a strip with the + on the desk, and press ▶ (or Space).</p>` },
    { g: "Getting started", t: "Models", site: "#start",
      s: "Choosing the instrument, and a deep dive on each model.",
      b: `<p><b>Settings, Models</b> (⚙ in the top bar) lists the preset models and any other supported model already in the Hugging Face cache, each marked downloaded or not, with the loaded one marked.</p>
      <p>Choose one to see its deep dive:</p>
      ${dl([["Identity", "its Hugging Face id, revision and commit, who made it and when, its licence and a link to its model card."],
        ["Architecture", "its family (GPT-2, GPT-NeoX or Llama-style), layers, heads, widths, vocabulary, context, positions and tokenizer."],
        ["Size", "its parameter count, its size on disk, and the memory its weights need at the precision it loads in, against what this machine has free."],
        ["Training", "its data and cut-off where the card gives them, and Pythia's training checkpoints."],
        ["What runs on it", "which strips and units the bench can run on that architecture. Position bend, for one, needs learned positions, which only GPT-2 has."]])}
      <p><b>Load</b> in the deep dive loads that model (with a revision, for Pythia's checkpoints). The <b>(i)</b> beside Load on the Instrument opens the same deep dive on the loaded model.</p>
      <p>Architecture and size are read from the model's own files; the facts no file holds are written by hand in <code>backend/config/models.md</code>. For a model that is not downloaded, <b>Fetch details from Hugging Face</b> asks huggingface.co for its page and config.json, and only then.</p>` },
    { g: "Getting started", t: "Tips", site: "#tips",
      s: "Tips on controls, and the keys worth knowing.",
      b: `<p>Rest the pointer on a knob, a fader or a switch and a small tip beside it gives its name and range. The info bar at the foot of the window gives the control's tip in full: one short line saying what the control does, as a formula where the transformation is one, and the way to use the control.</p>
      ${dl([["<code>h</code>", "the stream at a position"], ["<code>h'</code>", "what the strip leaves there"], ["<code>σ</code>, <code>μ</code>", "each dimension's spread and mean over the reference corpus"],
        ["<code>V</code>", "the principal directions"], ["<code>y</code>, <code>W</code>", "what a component writes, and its weight"]])}
      <p>Every VAU unit's manifest must give a tip for each of its parameters, and the host features have them too.</p>
      <h4>Keys</h4>
      ${dl([["Space", "runs the pair; while a job runs, stops it."], ["← →", "step the playhead; every meter on the desk follows."], ["Delete", "removes the selected strip; ⌘Z or Ctrl+Z puts it back."], ["⌘⌥B or Ctrl+Alt+B", "folds the browser."]])}` },

    // ------------------------------------------------------------ The desk and the chain
    { g: "The desk and the chain", t: "The dock and the Instrument", site: "#desk",
      s: "The chain at the foot of the window, starting with the model and its prompt.",
      b: `<p>The dock, at the foot of the window, holds the chain. First comes the <b>Instrument</b>: the model, the prompt it plays, and the sampler's knobs (temperature, top-k, top-p, tokens) and seed.</p>
      <p>The ▾ in the corner of the prompt lists the prompts run before, newest first; picking one puts it back in the Instrument and leaves the chain as it is. The (i) beside Load opens the deep dive on the model (see Models).</p>
      <p>The strips follow the Instrument, left to right. Most of them bend the model while it plays; the sampler acts last, on each token. Drag the dock's top edge to make it taller or shorter; double-click it to fold the dock away and bring it back.</p>
      <p>An error in the chain shows as a red note in the dock's bottom right corner.</p>` },
    { g: "The desk and the chain", t: "The dock's toolbar", site: "#desk",
      s: "The buttons left of the Instrument: views of the chain, saving, Snap, Pin, Sweep, Leave one out.",
      b: `${dl([["▥ ≡ {}", "show the chain as a desk, as text, or as the hook code it registers."],
        ["☆", "saves the chain under a name, in the browser's Chains."],
        ["↶", "puts back the last strip removed."],
        ["Snap (the camera)", "takes the Bench as it is on screen, from the top bar to the info bar, as a PNG, with no prompt: the page copies itself, styles, scroll positions and all, and draws the copy. Save PNG or Copy PNG from the box that opens."],
        ["Pin", "keeps the run on show. Later runs can then be set against it as well as against the original, which shows what one change did."],
        ["Sweep (the grid)", "moves the selected strip across every place its target can take (see Sweep)."],
        ["Leave one out", "runs the chain once without each strip (these runs are not kept) and marks each strip with a slim bar and a number: the word edit distance of the text without it from the whole chain's text. 0 means the strip makes no difference to the words; near 1, nothing is left in common."]])}
      <p>The toolbar down the right of the texts switches between Diff (±), Tokens and Plain (¶), between the original (O) and the pinned run as the comparison, and copies the run id (#). <b>Replay</b> (▶) writes the two texts out again side by side, token by token, with the timeline's playhead and the meters following; ■ stops it. <b>Tempo</b>, below it, is how fast: live (∞), or 24, 12, 6 or 3 tokens a second. Below live, a run's tokens are also shown at that pace as they come, and the finished run appears when they have all been shown. The timeline and the figure follow the same choice; the divergence point and the measures stay against the original.</p>
      <p>The texts' Export menu (⤓) has <b>Figure</b>, which draws the run as an SVG or PNG from its data: the prompt, the chain from the Instrument on, the two texts with the words only one has marked, how far they part, and the recipe. It comes out the same each time, and the SVG keeps the text as text.</p>` },
    { g: "The desk and the chain", t: "Strips", site: "#desk",
      s: "Switching, moving, selecting and removing strips.",
      b: `${dl([["The round light", "at the top left of a strip switches it on (orange) or bypasses it."],
        ["The help button (?)", "after the name opens the strip's own help: a unit's help with its figure, or the bench's own strips' page in this Help."],
        [METER, "after the title marks a meter: a strip that reads the model and leaves it unchanged, so the diverged text is the same with it or without it."],
        ["The header", "drag it to move the strip, or focus the strip's number and use the left and right arrow keys."],
        ["A click", "selects the strip; Delete or Backspace removes it, and ⌘Z or Ctrl+Z puts it back."],
        ["+", "after the last strip adds an intervention at the end; hover between two strips and a + appears there."]])}` },
    { g: "The desk and the chain", t: "Activity", site: "#desk",
      s: "The four-bar meter on each intervention strip: how much it changed what it touched.",
      b: `<p>The tiny four-bar meter at the top right of an intervention strip shows how much it changed what it touched at the shown step: the size of its change over the size of the stream or output it acted on.</p>
      <table class="t hb-t"><tbody>
        <tr><td>No bars</td><td>nothing at this step</td></tr>
        <tr><td>One or two green</td><td>under 25%</td></tr>
        <tr><td>Three orange</td><td>up to 100%</td></tr>
        <tr><td>Four red</td><td>more: a change larger than what it changed (a reflection, or a strong steer)</td></tr></tbody></table>
      <p>Hover over the meter for a box with the strip's activity at every step, its average and peak, and what it was measured on. Click the meter to pin its box open: it opens in the desk beside the strip, pushing the later strips along so that it covers nothing, follows the playhead, and appears in a snap. Click the meter again, or the box's ✕, to close it.</p>
      <p>Coarsen and Reorder show an empty meter, since they change weights or the order of layers. Meters and sampler strips have none.</p>` },
    { g: "The desk and the chain", t: "Transport and timeline", site: "#desk",
      s: "Running the pair, and stepping through it token by token.",
      b: `<p><b>The transport</b> in the top bar:</p>
      ${dl([["▶ (or Space)", "runs the pair."], ["■ (or Space while it runs)", "stops any job."], ["⟳", "lit, starts a new run whenever the chain, the prompt or the sampler changes."]])}
      <p><b>The Arrangement</b>, above the dock, shows the two texts. Along its top the <b>timeline</b> lays them out token by token, with a red mark where they part and a playhead. Click or drag on it, or use the arrow keys, and the meters and activity bars on the desk show that step.</p>` },
    { g: "The desk and the chain", t: "Browser and info bar", site: "#desk",
      s: "The list of interventions, meters, directions and chains on the left; the line of help at the foot.",
      b: `<p><b>The browser</b>, on the left, lists the interventions, the VAUs (by collection, then by kind), meters, directions and saved chains, with a search box. Earlier runs open from the Variorum tab.</p>
      ${dl([["Drag", "an item onto the desk to put it where you drop it."], ["Double-click", "an item to add it at the end."],
        ["A direction", "dropped on a Steer, Project out or Direction meter strip becomes its direction."], ["◂", "folds the browser to a rail; Ctrl+Alt+B (⌘⌥B) folds and unfolds it."]])}
      <p><b>The info bar</b> at the foot of the window says what the thing under the pointer does, and on the right what the server is doing.</p>` },
    { g: "The desk and the chain", t: "Where in the model", site: "#how",
      s: "Blocks, heads, MLPs and the residual stream, and how a line names them.",
      b: `<p>A transformer is a stack of <b>blocks</b>. Each block reads the <b>residual stream</b> (a vector per token that runs through the whole stack) and adds two things to it: the output of its <b>attention</b> layer, which is the sum of several <b>heads</b>, and the output of its <b>MLP</b>. GPT-2 small has 12 blocks of 12 heads.</p>
      ${dl([["<code>head=5.1</code>", "head 1 of block 5 (blocks and heads count from 0). <code>head=5.*</code> is every head in block 5; <code>head=5.1,7.3</code> lists several."],
        ["<code>attn=5</code>, <code>mlp=5</code>", "what block 5's attention layer or MLP adds to the stream."],
        ["<code>block=5</code>", "everything block 5 adds (its attention and MLP together)."],
        ["<code>layer=6</code>", "the residual stream itself, numbered as Vectorscope and Ablation Bench number it: layer 0 is the token and position embeddings entering block 0, and layer l is the stream after block l−1. <code>layer=all</code> is every layer; <code>layer=3-7</code> a range."]])}` },

    // ------------------------------------------------------------ Strips on the model
    { g: "Strips on the model", t: "Ablate", s: "Removes a component's output, or replaces it with its average.",
      b: `<p><code>ablate head=5.1 mode=zero</code> removes a component's output: whatever that head, attention layer, MLP or block would have added is not added.</p>
      ${dl([["<code>mode=zero</code>", "the harsher test: the model has never seen that component silent."],
        ["<code>mode=mean</code>", "replaces the output with its average over the reference corpus (<code>backend/config/reference-corpus.md</code>), which keeps the stream at a typical size and removes only what the component does for this text."]])}` },
    { g: "Strips on the model", t: "Scale", s: "Multiplies a component's output, or the stream, by k.",
      b: `<p><code>scale mlp=7 k=2</code> multiplies a component's output by k. <code>scale layer=6 k=1.5</code> multiplies the whole residual stream at that layer.</p>
      ${dl([["k = 1", "changes nothing."], ["k = 0", "is zero ablation."], ["k below 0", "reverses what the component adds."]])}` },
    { g: "Strips on the model", t: "Steer", site: "#direction", s: "Adds a direction to the residual stream at every token.",
      b: `<p><code>steer layer=6 dir=negation scale=4</code> adds scale × a direction to the residual stream at every token (contrastive activation addition, as in Vectorscope's Grammar Steering). A negative scale pushes the other way.</p>
      <p>The direction is used as stored, so its size matters: a direction with a large norm moves the stream further at the same scale.</p>` },
    { g: "Strips on the model", t: "Project out", site: "#direction", s: "Removes, or reverses, the stream's part along a direction.",
      b: `<p><code>project layer=all dir=negation mode=remove</code> removes the part of the residual stream that points along a direction, leaving the rest: the model then cannot carry that direction at those layers (directional ablation). This is the probe for the negation deficit: can a direction be taken away or turned round, and what happens to "not" when it is?</p>
      ${dl([["<code>mode=remove</code>", "takes the part away."], ["<code>mode=reflect</code>", "reverses it, so what pointed one way along the direction now points the other way."],
        ["<code>to=mean</code>", "measures the part from the stream's mean at that layer over the reference corpus, so removing it sets it to the ordinary amount rather than to none (mean-referenced, or affine, erasure, as OBLITERATUS offers it): a gentler cut."],
        ["<code>k=4</code>", "removes four directions at once, a subspace: the direction itself, then the next principal directions of the differences it was made from (its texts' last-token streams for a contrast, its tokens against the corpus for a passage, its high positions against its low for a decision direction). A direction from one word has only itself."]])}
      ${finding(`With the decision direction for negation on GPT-2 (four prompts, four seeds; negation words per 1,000, the original 23): removed on every layer, 0, with the texts collapsing; <code>to=mean</code> on every layer, 26, with the texts intact (−11.3 DUFS); at layer 10, to zero 0 (−12.9 DUFS), to the mean 8 (−22), <code>k=4</code> 8 with shorter texts (−12.1).`)}` },
    { g: "Strips on the model", t: "Noise", s: "Adds Gaussian noise to the stream, scaled to its size.",
      b: `<p><code>noise layer=4 sigma=0.3</code> adds random Gaussian noise to the residual stream.</p>
      ${dl([["<code>sigma</code>", "a share of the stream's size at each token (its root mean square), because the stream grows many times larger from the first layer to the last."],
        ["<code>abs=1</code>", "makes sigma an absolute amount."], ["<code>seed=</code>", "the noise's own seed (or the run's), so it is part of the recipe and repeats exactly."]])}` },
    { g: "Strips on the model", t: "Coarsen", s: "Rounds one block's weights to fewer bits.",
      b: `<p><code>coarsen block=5 bits=4</code> rounds the weight matrices of one block to 4-bit levels (or 8, 3, 2) and leaves the rest of the model at full precision: material grain as a local change.</p>
      <p>The rounding is Vectorscope's Precision Degradation method (per-tensor symmetric levels). The weights are put back after the run.</p>` },
    { g: "Strips on the model", t: "Reorder", s: "Skips, repeats or swaps blocks.",
      b: `${dl([["<code>reorder skip=6</code>", "runs the model without block 6."], ["<code>repeat=5</code>", "runs block 5 twice."], ["<code>swap=3,8</code>", "exchanges blocks 3 and 8."]])}
      <p>The model was never trained with its blocks in another order. While a reorder is on, the tool recomputes the whole text at every step instead of using its cache, so the run is slower.</p>` },
    { g: "Strips on the model", t: "Transplant", s: "Puts the stream from a run on another prompt into this one.",
      b: `<p><code>transplant layer=6 prompt="The worst thing about the city is" at=-1 from=-1</code> runs the model on the other prompt, takes the residual stream at layer 6 at its token <code>from</code> (−1 is the last), and puts it into this run at token <code>at</code> of the prompt (activation patching).</p>
      <p>A small change of wording at one point can leave the sampled text untouched; the control band tells you whether a change is larger than a change of seed.</p>` },
    { g: "Strips on the model", t: "Embedding bend", s: "Swaps two tokens' input embeddings, moves one toward another, or adds noise to one.",
      b: `${dl([["<code>embed swap=\" not, also\"</code>", "the model reads \"not\" with the embedding of \"also\" and the reverse, wherever they occur in the input, prompt and generated text alike. GPT-2 tokens usually begin with a space."],
        ["<code>mix=0.3</code>", "with a swap, the first word moves toward the second instead of trading places with it: <code>embed swap=\" archive, museum\" mix=0.3</code> reads \"archive\" with its embedding 30% of the way to \"museum\"'s, and leaves \"museum\" as it is. Mix 0 is neutral."],
        ["<code>embed token=\" not\" sigma=0.5</code>", "adds a fixed noise vector to one token's embedding."]])}
      <p>Only the input side changes: the model still writes "not" from its own output layer. Run through a Dose sweep, a mix shows how far a word's embedding can move before the text changes: on the archive prompt, halfway leaves the words as they were (−22 DUFS), all the way changes them (−18).</p>` },
    { g: "Strips on the model", t: "Vocoder and Pan", site: "#eq", s: "Another prompt's band levels imposed on the stream; attention biased by distance.",
      b: `<h4>Vocoder</h4>
      <p><code>vocoder layer=6 prompt="The storm broke over the sea" bands=16 mix=1</code> takes the prompt as a modulator. The stream at that layer over it (unchanged model, averaged over its tokens, less the corpus mean) is measured in bands of principal directions spaced logarithmically: narrow among the largest directions and wide in the tail, as a vocoder's bands are over frequency.</p>
      <p>At each position of the text being written (the carrier), each band is rescaled to the modulator's size in that band, keeping the carrier's direction within it. It works like a Transplant done in bands. Mix 0 is neutral; the attention sink is left alone. On the archive prompt, mix 0.5 changes the text and keeps it fluent (−20.7 DUFS); mix 1 breaks it apart (−8.6).</p>
      <h4>Pan</h4>
      <p><code>pan block=all depth=4 pan=0.5</code> adds a bias by distance to the attention scores in the chosen blocks: for a query at position q and an earlier key at k, −pan × depth × (q − k) / q.</p>
      ${dl([["pan above 0", "moves attention toward the most recent tokens."], ["pan below 0", "toward the start (the prompt)."], ["pan 0", "is neutral."]])}
      <p>It registers its own attention function for the run (the model's eager attention with the bias added) and puts the model's back after. At pan 1, depth 4, head 5.1's average look-back falls from 19 tokens to 3, and GPT-2 repeats itself ("is is is").</p>` },
    { g: "Strips on the model", t: "Rewrite and Patch", s: "A rank-one edit of one fact; a saved set of weight changes.",
      b: `<h4>Rewrite</h4>
      <p><code>rewrite block=5 prompt="The Eiffel Tower is located in the city of" subject="Eiffel Tower" target=" Rome"</code> edits one fact, inspired by ROME (Meng, Bau, Andonian and Belinkov 2022).</p>
      <p>The MLP's key at the subject's last token is read over the prompt and versions of it with a corpus passage's opening in front. A change to that MLP's output at that token is found by gradient descent so that the model writes the target. It is then made a rank-one change to the MLP's output projection through the covariance of the MLP's keys over the reference corpus, so that the subject's key gains the change and other keys as little as their likeness to it allows.</p>
      <p>The fit takes some seconds the first time and is kept. It acts as a hook (amount 0 is neutral), and <code>save=name</code> also writes it as a patch.</p>
      ${finding(`On GPT-2, at block 5, the chance of " Rome" after the prompt rises from 0.005 to 0.81; after "The Eiffel Tower is in" from 0.002 to 0.16; after "The Louvre is located in the city of" it stays at 0.006. The edit takes on its own prompt, carries over in part to paraphrases, and leaves other subjects nearly as they were.`)}
      <h4>Patch</h4>
      <p><code>patch file=name scale=1</code> loads <code>data/patches/name.safetensors</code>, whose tensors, keyed by the model's parameter names, are changes to add (or, with the file's metadata <code>kind=replace</code>, weights to move toward), scaled, for the run; the weights are put back after. Scale 0 is neutral.</p>
      <p>A model edited elsewhere can be read against itself unedited, with the meters, the loudness and Leave one out.</p>` },
    { g: "Strips on the model", t: "Position bend", s: "Shifts, scrambles or freezes the position embeddings (learned positions only).",
      b: `<p><code>position mode=shift k=200</code> changes which position embedding each token is read with.</p>
      ${dl([["<i>shift</i>", "reads position p + k (held within the table), so the model takes itself to be further into a text than it is. Shift by 0 is neutral."],
        ["<i>scramble</i>", "reads a fixed random other position for each (drawn from the seed, the same in every pass), so word order is lost."],
        ["<i>freeze</i>", "reads position k for every token."]])}
      <p>It needs learned position embeddings, which GPT-2 has; Pythia and Llama-style models use rotary positions and refuse it. On the archive prompt a shift of 600 collapses GPT-2 into "all and all a all all" (−2.8 DUFS); scramble and freeze lose the order (about −6 DUFS).</p>` },
    { g: "Strips on the model", t: "Exit", s: "Stops after a layer and writes from there.",
      b: `<p><code>exit layer=6</code> stops after layer 6 and writes from there through the final norm and the output layer: the model the Tap reads at that layer, run as the writer. Layer 12 (all of GPT-2 small) is neutral.</p>
      <p>On the archive prompt, leaving after layer 11 is still fluent (−10.6 DUFS); after layer 8 it repeats ("not necessarily necessarily"), after layer 4 it breaks apart. Like Reorder, it turns the cache off, so each step recomputes the text.</p>` },
    { g: "Strips on the model", t: "Token", s: "Zeros a word's input embedding, or bans the word.",
      b: `${dl([["<code>token word=\" not\" mode=zero</code>", "gives the word a zero input embedding wherever it occurs, in the prompt and in what the model writes: the model reads nothing at that point except, in GPT-2 and Pythia, its position. Zero needs each word to be a single token."],
        ["<code>mode=ban</code>", "stops the model writing the word: its first token is never chosen. A ban acts at the sampler, so the diverged model's probabilities are the original model's, and the desk draws the strip with a dashed border."]])}
      <p>Several words go between commas, each as typed: <code>word=" not, never"</code> is " not" and " never". GPT-2 words usually start with a space, and " Not" is a different token from " not". A ban that takes a word away tends to bring in its neighbours ("no", "n't"), which the diff shows.</p>` },
    { g: "Strips on the model", t: "Neurons", vau: "units.html#neuron", s: "Edits named MLP neurons, and finds the ones that differ where a word is coming.",
      b: `${UNIT_ONE("neuron")}
      <p class="hb-dim">The vNeuron strip is a unit: its help, as its help button shows it, opens above.</p>
      <p><b>Find neurons</b>, under Where it decides in the Directions panel, lists the neurons whose activation differs most between the positions where the model is about to write the words and the positions where it is least likely to. They are scored by that difference times the size of what each writes (as OBLITERATUS's vNeuron Lab scores candidates), with a second column for each one's direct push toward the words. Add puts a zeroing strip on the desk.</p>
      ${finding(`For " not, never, no" on GPT-2 the finder's top neurons are all in block 11, and neither zeroing the top three (27 negation words per 1,000 against the original's 23, at −42 DUFS) nor scaling them by 4 (24) changed the rate; the top three by direct push gave 23 and 31. The decision direction, spread over the whole stream, halves the rate or removes it. In GPT-2 small, negation is not held by a few neurons. The ranking describes where the neurons differ; it does not show that they cause the word.`)}` },

    // ------------------------------------------------------------ Effects and units (VAU)
    { g: "Effects and units (VAU)", t: "Units (VAU)", site: "#vau", vau: "#what",
      s: "Strips that come as Vector Abliteration Units, and adding your own.",
      b: `<p>The effects, and any strip you add yourself, are <b>Vector Abliteration Units</b> (VAUs, VAU 1); the built-in ones are VAU's <b>Core Collection</b>, named by VAU's short name with the collection's prefix (vShrink for Norm Shrink) and listed in the browser under VAUs, installed here as the Python package <code>vau</code>. A unit is one Python file.</p>
      <p>Its manifest gives its name, its parameters (with their ranges, defaults and the values at which it changes nothing), the kind of place in a model it acts on (the residual stream, a component's output, weights) and what it needs from the bench (the corpus statistics, principal directions, directions).</p>
      <p>The bench is its host: it puts the unit's strip on the desk and in the browser from the manifest, checks each line against it, attaches the unit's edit where the line says, watches how much it changes, and takes it off after the run. The Code view prints a unit's hook lines and its source.</p>
      <h4>Your own units</h4>
      <p>Put a unit file in <code>data/units/</code> and press <b>Rescan units</b> at the top of the browser's VAUs section. A unit is ordinary Python, so loading one runs it: the bench loads units only from that folder and the package, never from the network, and marks a unit that is not built in with ◆.</p>
      <p>A file that fails to load or to pass the checks is left out, and the browser says how many and why. A recipe records the package's version and each unit's version, source and file hash.</p>
      <p class="hb-dim">Loaded now: ${VAU.units.map((u) => u.title).join(", ") || "none"}.${VAU.errors.length ? ` Not loaded: ${VAU.errors.map((e) => `${e.file} (${e.error})`).join("; ")}.` : ""}</p>` },
    { g: "Effects and units (VAU)", t: "Effects", site: "#units", vau: "units.html",
      s: "Audio-style effects on the residual stream at a layer.",
      b: `<p>Each effect acts on the residual stream at one layer (or several), as Steer does. Its levels are set against the stream's ordinary size and spread at that layer, measured once over the reference corpus with the model unchanged.</p>
      <p>The first position of a text, where models put an attention sink, is left out of those measures, and vLookback, vAverage and vQuantise's hold neither change it nor draw on it (every model the Lens loads has a sink there). The units that keep earlier positions keep only the ones they read. At its neutral setting each one leaves the text exactly as the Original.</p>
      <p>Each effect has an activity meter like any other strip, and the Code view prints its hook.</p>
      ${UNIT_INTRO}${UNIT_LIST("effect")}` },
    { g: "Effects and units (VAU)", t: "Unit interventions", site: "#units", vau: "units.html",
      s: "Interventions that come as units, beside the bench's own.",
      b: `<p>Interventions that come as units (Vector Abliteration Units) rather than being written into the bench. They sit in the browser's Interventions with the bench's own.</p>
      ${UNIT_INTRO}${UNIT_LIST("intervention")}
      ${finding(`With the shipped negation contrast set, Abliterate at full strength and a flat kernel raised the rate of negations on four prompts (57 per 1,000 words, against 23 for the original; Project out on every layer gave 45). The direction is read at the last token of sentences such as "The door is not open", after the "not", so it marks having negated, not being about to; taking it out does not stop the model writing "not". Abliteration as Arditi et al. use it reads the direction where the model decides.`)}` },
    { g: "Effects and units (VAU)", t: "Fitted", vau: "units.html#morph",
      s: "Units worked out from a direction's texts before the run.",
      b: `<p>A fitted unit is worked out from the texts a direction was made from, once per setting, before the run. It takes some seconds the first time and is then kept in <code>_tmp/means/</code>.</p>
      <p>It changes what the attention layers and MLPs write, not the residual stream directly.</p>
      ${UNIT_INTRO}${UNIT_LIST("fitted")}` },
    { g: "Effects and units (VAU)", t: "Host features", site: "#envelope", vau: "spec.html#5a-host-features",
      s: "Wet, envelope, keep size, window and a random control, on every unit and stream strip.",
      b: `<p>Every unit, and the bench's own Steer, Project out, Noise and Scale on the residual stream, has five more controls, folded under <b>Host</b> at the foot of the strip (a number beside it says how many are set). The host applies them around the strip's own change, so every unit has them without implementing them (<code>vau.hostfx</code>).</p>
      ${dl([["Wet <code>wet</code>", "how much of the strip's change is applied, 1 all of it, 0 none."],
        ["Envelope <code>env</code>, <code>epeak</code>, <code>ewidth</code>, <code>eedge</code>", "the change scaled at each layer (or, for vMorph and vAbliterate, each block) by a curve with its peak, its reach either side and its value at that reach given as shares of the depth. Linear tapers in a straight line (as Heretic's kernel), bell along a Gaussian (as OBLITERATUS's weighting), flat is the same within reach. It matters on a line that names several layers (<code>layer=all</code>)."],
        ["Keep size <code>keepnorm=1</code>", "after the change, each position is scaled back to the size it had, so only its direction changes. The vShrink only changes sizes, so Keep size undoes it."],
        ["Window <code>wfrom</code>, <code>wto</code>", "the strip acts only from one step to another (<code>wfrom=10</code>: a Steer that starts at token 10). Step 1 is the pass that writes the first new token, as the meters count; the prompt's positions come before it, so a window leaves the prompt alone. <code>wto=0</code> is to the end; both 0 is everywhere."],
        ["Control <code>control=random</code>, <code>cseed</code>", "every direction the strip uses is replaced, at each layer, by a random direction of the same size, drawn from the seed, the direction's name and the layer, so the same line draws the same control. It shows what a push of the same size in no particular direction does. vMorph refuses it (it is fitted to a direction's texts, and a random direction has none); Noise has no direction."]])}
      <p>Read a control with the loudness meter: a random control of the same size is as loud for Steer, but for Project out it is much quieter, because a random direction carries little of the stream.</p>
      ${finding(`With the decision direction for " not, never, no" on GPT-2 (four prompts, four seeds each, negation words per 1,000; the original 23): Steer at layer 6, scale 1, gave 43 at −20.6 DUFS, and its random controls 19 and 31 at −21.4 and −20.6 DUFS, as loud but without the rise; Project out at layer 10 gave 0 at −12.9 DUFS, and its random control 21 at −31.8 DUFS.`)}` },
    { g: "Effects and units (VAU)", t: "Meter units", meter: true, site: "#meters", vau: "spec.html#5b-meters",
      s: "Meters that come as units, drawn on the strip like the bench's own and marked METER.",
      b: `<p>Meters can also come as units. A meter unit says whether it reads the stream at one layer or the model's next-token distribution, and how its readings are drawn (a number per step, or ranked words per step).</p>
      <p>The bench records what it reads in the meters' pass and draws it on the strip's screen, original and diverged, with a line over every step.</p>
      ${UNIT_INTRO}${UNIT_LIST("meter")}` },

    // ------------------------------------------------------------ The sampler
    { g: "The sampler", t: "Contrast", s: "Samples what the chain made likelier (contrastive decoding).",
      b: `<p><code>contrast alpha=1 keep=0.1</code> acts at the sampler, at every step. It runs the original model on the same text as well (every hook is switched off for that pass) and samples from log p<sub>diverged</sub> − α log p<sub>original</sub>, over the tokens the diverged model finds plausible (at least <i>keep</i> times its most probable token's probability); the rest are ruled out (contrastive decoding, inspired by Li et al. 2022).</p>
      <p>Words the chain made likelier gain; words both models favour equally lose. It enlarges the divergence itself. α 0 is neutral.</p>
      <p>It cannot run beside a strip that changes the model itself (Coarsen, Reorder, Exit), since the original model must be read in the same step. Like the other sampler bends it does not count in the loudness, which reads the models' distributions.</p>` },
    { g: "The sampler", t: "Chorus", s: "Several detuned copies of the model, averaged.",
      b: `<p><code>chorus layer=6 voices=3 sigma=0.3</code> writes with several slightly detuned copies of the model at once. Each voice is the chain with noise added to the stream at that layer (scaled to the stream's size, as Noise's is) from its own seed, run with its own cache. At each step the next token is drawn from the average of the dry chain's and the voices' probabilities.</p>
      <p>Voices 0 is neutral. Each voice is a further pass at every step, so three voices take about four times as long. Effects that keep earlier positions (vLookback, vAverage, vQuantise, vRepeat) share their memory between the voices.</p>` },
    { g: "The sampler", t: "Sampler bend", s: "Changes how the next token is chosen; the model is untouched.",
      b: `${dl([["<code>sample mode=ban-top k=1</code>", "forbids the k most probable next tokens."], ["<code>mode=ceiling p=0.3</code>", "allows only tokens with probability at or below p."], ["<code>mode=invert</code>", "makes the least probable of the allowed candidates the most likely."]])}
      <p>These act on the choice of the next token, not on the model: the diverged model's probabilities are the original model's, and the desk marks these strips with a dashed border. LLMbench's Sampling Probe is the related tool.</p>` },

    // ------------------------------------------------------------ Meters and reading
    { g: "Meters and reading", t: "Meters", meter: true, site: "#meters", s: "Four strips that read the model and leave it unchanged. The desk marks them METER.",
      b: `<p>Meters register no hook while the two texts are written. After the run, one more forward pass over each text, teacher-forced, fills them in: over the original text with the meters alone, over the diverged text with the whole chain. A meter placed after a strip on the same layer reads the stream after that strip; on other layers the order on the desk makes no difference.</p>
      ${dl([["<code>tap layer=6</code>", "the logit lens. The stream at that layer goes through the final norm and the output layer as if it were the last, and the strip shows the four words it points to most, and the rank and probability there of the word the model went on to write. At the top layer (12 for GPT-2) the tap is the model's own output. In the middle layers of GPT-2 the logit lens is rough: it shows what the output layer would make of the stream, which the later layers may still change."],
        ["<code>meter layer=6</code>", "the stream's size (its L2 norm) at each step."],
        ["<code>gauge layer=6 dir=negation</code>", "the stream's component along a direction (the dot product with the unit direction at that layer), and its cosine with it. After a Project out it should read near zero."],
        ["<code>scope head=5.1</code>", "the attention weights of one head from the current token, over every token before it, the four largest shown. <sub>p3</sub> marks the third prompt token, <sub>3</sub> the third generated one. Many heads put most of their weight on the first token."]])}
      <h4>Steps</h4>
      <p>Step <i>j</i> is the forward pass that chose token <i>j</i>: it reads the token before it (the last prompt token, at step 1) and writes token <i>j</i>, shown as "read" → "written". Every meter shows the same step. ◀ ▶ on any meter move it, a click on the line under a meter goes to that step, and in the Tokens view a click on a token goes to its step.</p>
      <p>Up to the point where the texts part, the two runs read the same tokens, so a difference between the readings there comes from the chain alone; after it, the texts differ too.</p>` },
    { g: "Meters and reading", t: "Loudness", site: "#loudness", s: "How far the chain moves the next-token distribution, in DUFS.",
      b: `<p>The meter in the desk's <b>OUT</b> column measures how far the chain moves the model's next-token distribution, read at the output, inspired by the loudness measures of broadcast audio (LUFS, ITU-R BS.1770 and EBU R 128).</p>
      <p>At each step of a text both models give a distribution over the next token, on the same text. The reading is the KL divergence of the diverged model's distribution from the original's, in bits: the extra bits per token it costs to code the original's next token with the diverged model's distribution.</p>
      <p>For small changes the KL grows with the square of the change in the logits, as power grows with the square of an amplitude, so it is put in decibels with 10 log<sub>10</sub>, as LUFS puts mean square. The bench calls its decibel the <b>vecibel</b> (vB), so that it is not taken for sound: 10 log<sub>10</sub> of a ratio of two divergences. +10 vB is ten times, +3 vB about twice, −10 vB a tenth.</p>
      <p><b>DUFS</b> (Divergence Units relative to Full Scale) is 10 log<sub>10</sub>(KL / full scale), where full scale is log<sub>2</sub> of the vocabulary size (15.6 bits for GPT-2): 0 DUFS is a KL of that size, −10 DUFS a tenth of it, −20 a hundredth. A strip that changes nothing reads silent.</p>
      <table class="t hb-t"><thead><tr><th>Reading</th><th>What it is</th><th>On the meter</th></tr></thead><tbody>
        <tr><td><b>Momentary</b></td><td>one step; green below −30, amber to −12, red above (display bands only)</td><td>the bar, at the playhead's step</td></tr>
        <tr><td><b>Short-term</b></td><td>the mean KL over the last 8 steps</td><td>the white line on the bar</td></tr>
        <tr><td><b>Integrated</b></td><td>the mean KL over the text, gated as BS.1770 gates loudness: steps below −70 DUFS are left out, then steps more than 10 vB below the mean of the rest</td><td>the number under the bar</td></tr>
        <tr><td><b>Range</b></td><td>the spread of the short-term readings, 10th to 95th percentile, after a gate 20 vB below their mean, as EBU Tech 3342 measures loudness range; a chain that is quiet with occasional jolts has a wide range</td><td>the hover box</td></tr>
        <tr><td><b>Peak</b></td><td>the loudest single step</td><td>the red tick</td></tr></tbody></table>
      <p>The meter reads the original text, which is the same text whatever the chain, so two chains' readings compare directly; the hover box gives the diverged text's readings as well, with the momentary readings over every step. Sampler bends do not change the model's distributions and are not counted.</p>
      <p>Mean-ablating head 5.1 of GPT-2 reads about −33 DUFS on the archive prompt; a Steer at layer 6 along negation at scale 2 about −15, at scale 8 about −5.</p>` },
    { g: "Meters and reading", t: "Self-repair", s: "How much the layers after a strip damp or carry its change.",
      b: `<p>After a run, each strip's activity box ends with its <b>self-repair</b> reading, and the Sweep can show the same reading at every place (<b>Repair vB</b>). For the strip on its own, on the original text, two loudnesses are compared.</p>
      ${dl([["The direct path", "every change its hooks make, in the stream's terms (a head's or a neuron's change is carried through its output projection), added to the unchanged model's final stream and read through the final norm and the output layer, as if no layer after the strip reacted to it."],
        ["The total", "what the model does with the strip in place."]])}
      <p>Repair is 10 log<sub>10</sub>(total ÷ direct), in vB. Below 0, the layers after the strip damp its change: the model repairs it, as McGrath et al. (2023) found when they named the Hydra effect. Above 0, most of the strip's effect runs through the layers after it rather than straight to the output.</p>
      <p>A strip in the last block, or at the top layer, reads 0, since nothing comes after it. For a strip at several places, their changes are added, which is an approximation, and the box says so.</p>
      ${finding(`On GPT-2 and the archive prompt, zeroing each block's attention in turn reads +23, +10, +9, +11, +10, +9, +10, +6, +3, −1, −4 and −5 vB from block 0 to block 11: the early layers' effects run almost wholly through what comes after them, and from block 9 on, the later layers damp the change. Zeroing MLP 0 reads +25 vB; mean-ablating head 0.1, +21.`)}` },
    { g: "Meters and reading", t: "Sweep", s: "One strip moved across every place it can go, read for loudness.",
      b: `<p><b>Sweep</b> (the grid icon in the dock's toolbar) moves the selected strip, on its own, across every place its target can take: every head (a grid of blocks by heads), every block's attention, MLP or whole block, or every place in the stream (a row).</p>
      <p>At each place it reads the last run's original text once, teacher-forced, with that strip alone, and records the loudness (integrated DUFS), the mean KL in bits, and the share of steps at which the model's most likely next token changes. Nothing is generated, so all 144 heads of GPT-2 small take about three seconds.</p>
      <p>The grid shows loudness or changed choices; a click on a cell puts that target on the strip, outlined in gold. It answers where in the model a strip is loudest, which is OBLITERATUS's question of where a behaviour is anchored, asked of any strip.</p>
      ${finding(`On GPT-2 and the archive prompt: zeroing MLP 0 is by far the loudest of the MLPs (−4.9 DUFS, the top token changed at 88% of steps); mean-ablating head 0.1 is the loudest head (−18 DUFS), head 7.2 the quietest (−56); a Steer along negation is loudest at the top layer. The Component map asks the slower question of what the generated text does at each place.`)}` },

    // ------------------------------------------------------------ Views
    { g: "Views", t: "Before and after", site: "#views", s: "The two texts side by side, and the measures between them.",
      b: `${dl([["Diff", "marks the words only the original has (struck through) and the words only the diverged text has (highlighted)."],
        ["Tokens", "shows each token; the first token where the runs part is outlined, and a click on any token shows the five most probable tokens at that point."],
        ["The divergence point", "box shows both runs' top five at the token where they part."],
        ["A line number", "click it to annotate the line with one of LLMbench's six types (observation, question, metaphor, pattern, context, critique)."]])}
      <h4>The measures</h4>
      ${dl([["Word edit distance", "the fewest word insertions, deletions and substitutions to turn one text into the other, divided by the longer text's length."],
        ["Bigram distance", "1 minus the overlap of the two texts' word pairs."], ["Distinct-2", "unique word pairs over all word pairs: falls as text repeats."],
        ["Repetition rate", "the share of word triples that occur more than once."], ["Grammar and stance words", "the Grammar Probe's constructions, and counts of hedges, boosters, negation and evaluative words from word lists ported from LLMbench."]])}` },
    { g: "Views", t: "Probabilities", site: "#views", s: "Each text coloured by how probable each token was.",
      b: `<p>Each text coloured by how probable each token was, under its own model and under the other.</p>
      ${dl([["Perplexity", "the default unit: 2 to the mean surprisal in bits; lower is more expected."], ["Bits", "the mean surprisal itself."]])}
      <p>Exports give surprisal and entropy in bits, as LLMbench's do. Scoring a text under the other model uses the same weights with or without the chain's hooks, and the two are labelled and never pooled.</p>` },
    { g: "Views", t: "Dose sweep", site: "#views", s: "One knob swept across a range, the outputs stacked.",
      b: `<p>Sweeps one knob of one strip across a range and stacks the outputs, with the distance from the original, distinct-2, the repetition rate and the surprisal under the original model drawn against the dose.</p>
      <p>The <b>breakdown point</b> is the first dose where distinct-2 falls below half the original's, the repetition rate exceeds 0.5, or the surprisal under the original model exceeds three times the original text's. These thresholds are a starting point and decide where the tool says the prose has broken.</p>` },
    { g: "Views", t: "Control band", site: "#views", s: "The same model reseeded: how far a change of seed alone moves the text.",
      b: `<p>A single diverged text differs from the original, but so does the same model with another seed. The control band generates the original again with n other seeds and measures each against the original as the diverged text is measured.</p>
      <p>If the diverged text's distance lies inside the reseeds' range, the tool reports it as <b>inside the band</b>: the chain moved the text no further than a change of seed does. Make the band before reading anything into a distance.</p>` },
    { g: "Views", t: "Component map", site: "#views", s: "One intervention applied to every head or layer in turn, generated and probed.",
      b: `<p>Applies one intervention to every head (or every layer) in turn, generates from a few prompts, and draws a grid of how a probe changes:</p>
      <ul><li>the Grammar Probe's antithesis constructions ("Not X but Y" and its relatives)</li><li>counts of hedges, boosters, negation and evaluative words</li><li>distinct-2, repetition, surprisal under the original model, or distance from the original</li></ul>
      <p>Click a cell to read its texts and put that intervention on the Bench. A full head map of GPT-2 small is 144 cells per prompt and takes a few minutes. A single cell's change should be checked against the control band before it is read as the component's.</p>` },
    { g: "Views", t: "Directions", site: "#direction", s: "Vectors in the residual stream: making, combining, importing and exporting them.",
      b: `<p>A direction is a vector in the residual stream. The Directions panel makes them several ways.</p>
      ${dl([["Two lists", "the difference between the average residual-stream vectors of two lists of texts at their last token, at every layer (Vectorscope's Grammar Steering method). This is the way to ablate a concept: texts with it against texts without it, then Project out at <code>layer=all</code>."],
        ["A word", "the word as the output layer writes it, its row of the unembedding matrix (centred where the final norm is a LayerNorm). Projected out at the top layer (<code>project layer=12 dir=… mode=remove</code> for GPT-2) it takes the word out of the likely next tokens and leaves the rest of the text fluent: after \"He said that he would\", \" not\" falls from first place (p 0.10) out of the top five. At every layer it also changes how the model reads, and the text degrades sooner. A negative steer pushes away from the word. For GPT-2, whose input and output embeddings are the same matrix, it is also close to the word's input embedding. The final norm stands between the stream and the output, so the removal is close but not exact; the Token strip's ban is exact."],
        ["A sentence or passage", "the average residual stream over the text's tokens minus the average over the reference corpus's tokens, at every layer: what is particular to the text against ordinary prose, topic and register as much as meaning. Several lines are averaged."],
        ["Where it decides", "where the model is about to write a word (or one of several). The model reads the reference corpus and any contexts given, and at every position gives the chance that the next token is one of the words; the direction at each layer is the mean residual stream at the positions where that chance is highest (the top tenth, by default) minus the mean where it is lowest (the bottom half). It is read before the word, where the model decides, as Arditi et al. read the refusal direction at the end of the instruction before the response."],
        ["Add and subtract", "a direction made from others, layer by layer (<code>negation - 0.5 * not-x-but-y</code>)."]])}
      ${finding(`A contrast set is read at the end of each sentence, after the construction, so its direction marks having written it, and removing that direction did not stop GPT-2 writing "not" (it wrote more). With the decision direction for " not, never, no" on GPT-2, over four prompts and four seeds each: 23 negation words per 1,000 in the original, 11 with Abliterate at its defaults (−26 DUFS), none with Project out at layer 10 (−13 DUFS) with the texts intact, 8 with Steer at −1 and 43 with Steer at +1.`)}
      <h4>Contrast sets and files</h4>
      <p>The tool ships two contrast sets, Negation and Not X but Y, as editable Markdown in <code>backend/config/contrasts/</code>. A direction is a product of its lists: whatever separates them (length, topic, a final word) is in it.</p>
      <p>Directions made here are saved per model; a run's recipe carries a copy of each direction it used. Import reads files from this tool and Ablation Bench, and Vectorscope Grammar Steering exports.</p>
      <p><b>GGUF</b> exports a direction as a llama.cpp control vector and Import reads one: llama.cpp adds <code>direction.N</code> at the output of block N, which is this bench's layer N + 1, so layers 2 to n are written and read as direction.1 to direction.n-1, and layers 0 and 1 have no place in the format.</p>
      <h4>Inspired by repeng</h4>
      <p>Theia Vogel's library for control vectors. The two lists can be read by <b>PCA</b> as well as by the difference of means:</p>
      ${dl([["PCA of the pairs' differences", "the first principal component of each positive text's stream minus its negative's (the lists read as pairs, line by line)."],
        ["PCA about each pair's midpoint", "the same, of both lists centred on each pair's midpoint."]])}
      <p>Each is signed so that most positives lie above their negatives, and scaled to the difference of means along it, so that a Steer's scale means the same. On the shipped negation set, whose pairs differ in one word, the three agree (cosine 0.999); they part where pairs differ in more than one way.</p>
      <p><b>Make pairs from a template</b> writes the lists from a sentence with a slot ({x}), positive and negative words in the same order, and optionally endings cut from the corpus's passages, as repeng builds its sets.</p>` },

    // ------------------------------------------------------------ Runs, exports and recipes
    { g: "Runs, exports and recipes", t: "Recipes", site: "#recipes", s: "What every run records, so that it can run again.",
      b: `<p>Every run keeps its <b>recipe</b>: the model, its revision hash, precision and device, the prompt, the seed, the sampler settings, the chain, and any directions the chain uses.</p>
      <p>A recipe can be exported and run again. On the same machine and library versions it gives the same texts, and the tool checks this when it regenerates.</p>` },
    { g: "Runs, exports and recipes", t: "Variorum", site: "#views", s: "Every run kept with its recipe, opened, compared and traced.",
      b: `<p>Every run is kept with its recipe in <code>runs/</code>.</p>
      ${dl([["Open", "puts a run back on the Bench; a run made after opening another records it as its parent, and a regeneration records the run it repeats as the one it is a witness of."],
        ["Compare", "sets two diverged texts side by side."],
        ["The bench-kit bundle", "exports the texts as versions with numbered lines and their descent, in the shape bench-kit's version list reads (see <code>docs/bench-kit-notes.md</code>)."]])}` },
    { g: "Runs, exports and recipes", t: "Exports", s: "Markdown, JSON and the recipe.",
      b: `${dl([["Markdown", "for quoting, with numbered lines, the measures and the annotations."],
        ["JSON", "the whole run: every token's log probability, entropy and top five, surprisal in bits, the measures, the band and the annotations."],
        ["Recipe", "what is needed to run it again, with the texts it produced, so that Variorum ▸ Load a recipe can check that a regeneration matches."]])}` },

    // ------------------------------------------------------------ Reference and credits
    { g: "Reference and credits", t: "Credits", site: "#credits", s: "Whose ideas and tools the bench draws on.",
      b: `<p><b>Terence Broad</b>'s ideas strongly influenced Abliteration Lens: his work on active divergence (Broad, Berns, Colton and Grierson 2021, "Active Divergence with Generative Deep Learning: A Survey and Taxonomy") and network bending (Broad, Leymarie and Grierson 2021, "Network Bending: Expressive Manipulation of Deep Generative Models"), and his Sussex AI seminar "Expanding the generative space" (University of Sussex, 14 October 2026).</p>
      <p><b>Ableton Live</b>: its audio devices inspired the effects, and its layout inspired the Bench. Abliteration Lens is not affiliated with Ableton.</p>
      <p>The methods individual strips draw on are named on their own Help pages. The full list is in the site's credits.</p>` },
  ];
  // The bench's own strips: a topic's summary is the line the desk shows for the strip
  // (Desk.SPECS[kind].what), so the strip's tip and its Help say the same.
  const SPEC = { "Ablate": ["ablate"], "Scale": ["scale"], "Steer": ["steer"], "Project out": ["project"], "Noise": ["noise"],
    "Coarsen": ["coarsen"], "Reorder": ["reorder"], "Transplant": ["transplant"], "Embedding bend": ["embed"],
    "Vocoder and Pan": ["vocoder", "pan"], "Rewrite and Patch": ["rewrite", "patch"], "Position bend": ["position"],
    "Exit": ["exit"], "Token": ["token"], "Contrast": ["contrast"], "Chorus": ["chorus"], "Sampler bend": ["sample"] };
  const specs = (typeof Desk !== "undefined" && Desk.SPECS) || {};   // desk.js loads first
  for (const x of T) {
    const lines = (SPEC[x.t] || []).map((k) => (specs[k] || {}).what).filter(Boolean);
    if (lines.length) x.s = lines.map((l, i) => (i ? l[0].toLowerCase() + l.slice(1) : l)).join("; ") + ".";
  }
  // links out: the Lens site's section, the VAU site's page or section
  for (const x of T) {
    if (x.site) x.site = SITE + x.site;
    if (x.vau) x.vau = VAUSITE + x.vau;
  }
  window.HELP = T;      // shown by the Help box (boxes.js)
  // a strip's help button on the bench's own strips opens the Help box at the strip's topic
  window.HELP_FOR = Object.fromEntries([...Object.entries(SPEC).flatMap(([t, ks]) => ks.map((k) => [k, t])),
    ...["tap", "meter", "gauge", "scope"].map((k) => [k, "Meters"])]);
  window.HELP_LINKS = { site: SITE, vau: VAUSITE };
})();
