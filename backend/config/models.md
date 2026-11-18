# Abliteration Lens preset models

The models offered in the picker and in Settings, Models. Edit the YAML block and reload the page. Any model in the Hugging Face cache, or a local folder holding a Hugging Face checkpoint, can also be typed into the picker. Supported architectures: GPT-2, GPT-NeoX (Pythia) and Llama-style (Llama, Qwen, Mistral, OLMo-2). Models load with `trust_remote_code=False`. The format follows Vectorscope's `backend/config/models.md`: `id`, `name`, `year`, `layers`, `heads`, `note` and `checkpoints` are Vectorscope's fields.

The other fields are facts that no file in the cache holds, shown in the deep dive (Settings, Models, and the (i) on the Instrument). Each was checked against the model's Hugging Face card or its paper, listed under `sources`; a field is left out where those do not state it. Architecture and size are never written here: they are read from each model's own files.

- `org`: who made it. `released`: when, as the sources give it. `licence`, `gated` (access must be requested on Hugging Face).
- `card`: the model card. `paper`: the paper or report.
- `params_stated`: the parameter count as the card gives it (the panel also counts the weights themselves once they are on this machine). `context_stated`: the context length as the card gives it, where it differs from config.json's.
- `training`: the data. `tokens`: how many it was trained on. `cutoff`: the data's cut-off.
- `kind`: base (pretrained only) or post-trained.

```yaml
models:
  - id: openai-community/gpt2
    name: GPT-2 small (124M)
    year: 2019
    layers: 12
    heads: 12
    note: The reference model for head-level interpretability work. Default.
    org: OpenAI
    released: 14 February 2019 (the smallest of the four GPT-2 sizes, released first)
    licence: MIT
    params_stated: 124M
    kind: base
    training: WebText, the text of web pages linked from Reddit posts with at least 3 karma; about 8 million documents, 40 GB, with Wikipedia removed.
    cutoff: The version of WebText used leaves out links created after December 2017.
    card: https://huggingface.co/openai-community/gpt2
    paper: Radford et al. (2019) Language Models are Unsupervised Multitask Learners. https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf
    sources:
      - https://huggingface.co/openai-community/gpt2
      - https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf (section 2.1)
      - https://arxiv.org/abs/1908.09203 (the staged release, February 2019)
  - id: Qwen/Qwen3-0.6B
    name: Qwen3 0.6B
    year: 2025
    layers: 28
    heads: 16
    note: A recent Llama-style model. bf16; a full head sweep is 448 runs.
    org: Qwen team, Alibaba Cloud
    released: 29 April 2025 (the Qwen3 announcement)
    licence: Apache-2.0
    params_stated: 0.6B (0.44B without the embeddings)
    context_stated: 32,768 tokens
    kind: post-trained (pretraining and post-training; the base model is Qwen/Qwen3-0.6B-Base)
    training: About 36 trillion tokens in 119 languages and dialects; web text, text drawn from PDF-like documents, and synthetic mathematics and code.
    tokens: about 36 trillion
    card: https://huggingface.co/Qwen/Qwen3-0.6B
    paper: Qwen Team (2025) Qwen3 Technical Report. https://arxiv.org/abs/2505.09388
    sources:
      - https://huggingface.co/Qwen/Qwen3-0.6B
      - https://qwenlm.github.io/blog/qwen3/
  - id: EleutherAI/pythia-160m
    name: Pythia 160M
    year: 2023
    layers: 12
    heads: 12
    note: Has training checkpoints (step1000 to step143000); choose one in the revision box.
    checkpoints: true
    org: EleutherAI
    released: February 2023 on Hugging Face; the paper is dated 3 April 2023
    licence: Apache-2.0
    params_stated: 162,322,944 (85,056,000 without the embeddings)
    kind: base
    training: The Pile, not deduplicated.
    tokens: 299,892,736,000
    checkpoint_note: "154 checkpoints, each a revision named by its training step: step0, ten log-spaced steps (step1, step2, step4 to step512), and every 1000 steps from step1000 to step143000. step143000 is the same as main."
    card: https://huggingface.co/EleutherAI/pythia-160m
    paper: Biderman et al. (2023) Pythia, a Suite for Analyzing Large Language Models Across Training and Scaling. https://arxiv.org/abs/2304.01373
    sources:
      - https://huggingface.co/EleutherAI/pythia-160m
      - https://huggingface.co/api/models/EleutherAI/pythia-160m (createdAt, the repository's date)
      - https://arxiv.org/abs/2304.01373
  - id: EleutherAI/pythia-410m
    name: Pythia 410M
    year: 2023
    layers: 24
    heads: 16
    note: Has training checkpoints. About 900 MB to download.
    checkpoints: true
    org: EleutherAI
    released: February 2023 on Hugging Face; the paper is dated 3 April 2023
    licence: Apache-2.0
    params_stated: 405,334,016 (302,311,424 without the embeddings)
    kind: base
    training: The Pile, not deduplicated.
    tokens: 299,892,736,000
    checkpoint_note: "154 checkpoints, each a revision named by its training step: step0, ten log-spaced steps (step1, step2, step4 to step512), and every 1000 steps from step1000 to step143000. step143000 is the same as main."
    card: https://huggingface.co/EleutherAI/pythia-410m
    paper: Biderman et al. (2023) Pythia, a Suite for Analyzing Large Language Models Across Training and Scaling. https://arxiv.org/abs/2304.01373
    sources:
      - https://huggingface.co/EleutherAI/pythia-410m
      - https://huggingface.co/api/models/EleutherAI/pythia-410m (createdAt, the repository's date)
      - https://arxiv.org/abs/2304.01373
  - id: meta-llama/Llama-3.2-3B
    name: Llama 3.2 3B (base)
    year: 2024
    layers: 28
    heads: 24
    note: Larger; chains run, sweeps are slow.
    org: Meta
    released: 25 September 2024
    licence: Llama 3.2 Community License
    gated: true
    params_stated: 3.21B
    kind: base
    training: Up to 9 trillion tokens from publicly available sources.
    tokens: up to 9 trillion
    cutoff: December 2023
    card: https://huggingface.co/meta-llama/Llama-3.2-3B
    sources:
      - https://huggingface.co/meta-llama/Llama-3.2-3B
```
