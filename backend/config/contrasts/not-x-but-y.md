---
title: Not X but Y
written: 2026-11-13, for Abliteration Lens, by Claude (Anthropic) at David M. Berry's request; to be revised
use: a direction for the antithesis construction LLMbench's Grammar Probe counts (pattern not-x-but-y)
---

# Not X but Y

Each positive line ends inside the construction "not X but", where the model is about to supply Y. The negative line at the same position states the same topic as a plain predication of similar length. The last token differs ("but" against a noun or adjective), so the direction mixes the construction with the word "but"; the shuffled and matched controls in Ablation Bench address that kind of confound.

## Positive

- Democracy is not a system of government but
- The city is not a place to live but
- Education is not the filling of a pail but
- Memory is not a store of facts but
- The market is not a natural order but
- Writing is not a record of thought but
- Freedom is not the absence of rules but
- Language is not a tool for naming but
- The museum is not a building but
- Science is not a body of facts but
- Friendship is not an exchange of favours but
- Software is not a set of instructions but
- The archive is not a neutral store but
- Work is not a way to earn money but
- The map is not a picture of the land but
- Reading is not the decoding of words but
- Time is not a line but
- Music is not a sequence of notes but
- The law is not a list of rules but
- History is not a record of events but

## Negative

- Democracy is a system of government that
- The city is a place where many people
- Education is a process that takes many
- Memory is a store of facts and
- The market is a place where goods
- Writing is a record of thought that
- Freedom is the absence of rules that
- Language is a tool for naming things
- The museum is a building in the
- Science is a body of facts about
- Friendship is an exchange of favours between
- Software is a set of instructions that
- The archive is a store of documents
- Work is a way to earn money
- The map is a picture of the land
- Reading is the decoding of written words
- Time is a line that runs from
- Music is a sequence of notes that
- The law is a list of rules that
- History is a record of events in
