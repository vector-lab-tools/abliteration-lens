# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
The bench as a host for Vector Abliteration Units (VAU 1, the package `vau`, from
https://github.com/vector-lab-tools/vector-abliteration-units).

The bench's own strips (Ablate, Scale, Steer, Project out, Noise, Coarsen, Reorder,
Transplant, the embedding and token bends, the meters and the sampler bend) are written
into interventions.py. Every other strip is a unit: the built-in units that come with the
package, and any in data/units/ (local files only; loading one runs it, and the desk marks
it as not built in). Units enter the same catalogue as the bench's own strips
(interventions.SPECS), so the parser, the desk, the browser, Help and the Code view treat
them alike.

The host gives units the language model through the bench's adapter (model.ModelMap): the
residual stream at a layer ("stream", numbered as hidden states), each block's attention
and MLP output ("output"), statistics and principal directions of the stream over the
reference corpus ("stats", "pca"), the bench's directions, and the reference corpus itself.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Dict, List, Optional

import vau

from . import ROOT

USER = ROOT / "data" / "units"
CAPABILITIES = {"stream", "output", "weights", "logits", "ordered", "stats", "pca", "directions", "texts", "contrasts"}   # logits: read by meters

_registry: Optional[vau.Registry] = None
_own: set = set()


def registry() -> vau.Registry:
    global _registry
    if _registry is None:
        rescan()
    return _registry


def rescan() -> vau.Registry:
    """Load (or load again) every unit, and put them in the strip catalogue."""
    global _registry, _own
    from .interventions import SPECS
    for k in [k for k, v in SPECS.items() if v.get("vau")]:
        del SPECS[k]
    _own = set(SPECS)
    _registry = vau.Registry([(USER, "user")], taken=_own).load()
    for u in _registry:
        SPECS[u.id] = spec(u)
    return _registry


def spec(u: vau.Unit) -> Dict[str, Any]:
    knobs: Dict[str, Any] = {}
    for p in u.m["params"]:
        if p["kind"] in ("knob", "fader", "int"):
            knobs[p["key"]] = [p["min"], p["max"], p["default"]]
        elif p["kind"] == "choice":
            knobs[p["key"]] = list(p["choices"])
        else:
            knobs[p["key"]] = p["kind"]
    return {"title": name(u), "level": u.m["level"], "what": u.m["what"], "targets": list(u.m["targets"]),
            "knobs": knobs, "vau": True}


def explain_files() -> Dict[str, Path]:
    """The explainer files a page may load (vau's runtime, its styles, the example texts, and
    each loaded unit's <id>.explain.js), by name."""
    return vau.explain_files(registry())


def look_files() -> Dict[str, Path]:
    """The stylesheets that give a collection's units their look (core.css), by name; none from a
    vau older than 0.2.0, which has no looks, so the desk draws units in its own colours."""
    files = getattr(vau, "look_files", None)
    return files() if files else {}


def unit(kind: str) -> Optional[vau.Unit]:
    return registry().get(kind)


def name(u: vau.Unit) -> str:
    """The Lens names a unit by VAU's short name everywhere (Clamp for Component Clamp);
    a unit whose manifest gives none keeps its title."""
    return u.m.get("short") or u.m["title"]


def catalogue() -> Dict[str, Any]:
    c = registry().catalogue(CAPABILITIES)
    c["units"] = [dict(m, full=m["title"], title=m.get("short") or m["title"]) for m in c.get("units", [])]   # VAU's full title kept as full
    c["host"] = {"name": "Abliteration Lens", "capabilities": sorted(CAPABILITIES), "user_folder": "data/units",
                 "package": vau.__version__}
    cols = c.setdefault("collections", {})            # vau's own entries (with their interface, from 0.2.1) are kept;
    for k, v in getattr(vau, "COLLECTIONS", {}).items():   # a title and a line for each, for the lists' headings
        cols.setdefault(k, {})
        cols[k].setdefault("title", v.get("title", k))
        cols[k].setdefault("what", v.get("what", ""))
    return c


def direction_names(s) -> List[str]:
    """The directions a strip names: dir= for the bench's own strips, every direction
    parameter for a unit."""
    u = unit(s.kind)
    keys = u.direction_keys() if u else ["dir"]
    return [s.params[k] for k in keys if s.params.get(k)]


def provenance(chain) -> Dict[str, Any]:
    """For a recipe: the package version and, for each unit the chain uses, its version,
    where it came from and the hash of its file."""
    used = {}
    for s in chain.active:
        u = unit(s.kind)
        if u and u.id not in used:
            used[u.id] = {"version": u.m.get("version"), "source": u.source, "file": u.path.name,
                          "sha256": hashlib.sha256(u.path.read_bytes()).hexdigest()}
    return {"vau": vau.VAU_VERSION, "package": vau.__version__, "units": used} if used else {}


class BenchHost(vau.Host):
    name = "Abliteration Lens"

    def __init__(self, sess=None, run=None, directions=None, att=None, mp=None):
        self.sess, self.run, self.dirs, self.att = sess, run, directions, att
        self.mp = mp if mp is not None else (sess.map if sess is not None else None)

    def capabilities(self):
        return set(CAPABILITIES)

    def error(self, lineno, msg):
        from .interventions import ChainError
        return ChainError(f"Line {lineno}: {msg}")

    @property
    def device(self):
        return next(self.sess.require()[0].parameters()).device

    def layers(self, strip):
        from .interventions import _rlayers
        return _rlayers(strip.target()[1], self.mp.n_layers, strip.lineno)

    def depth(self):
        return self.mp.n_layers

    def blocks(self, strip):
        from .interventions import _layers
        return _layers(strip.target()[1], self.mp.n_layers, strip.lineno)

    def component(self, kind, layer):
        """A block's output projection: attention's (from the heads) or the MLP's (from its hidden units)."""
        return self.mp.head_proj(layer) if kind == "attn" else self.mp.mlp_proj(layer)

    def component_path(self, kind, layer):
        return self.mp.path("head_proj" if kind == "attn" else "mlp_proj", layer)

    def direction_texts(self, name, lineno):
        src = self.dirs.get(name, lineno).data.get("source", {})
        return {"positive": list(src.get("positive", [])), "negative": list(src.get("negative", []))}

    def capture(self, texts, modules):
        """Each module's input and output at every token of each text, stacked over the texts, on
        the unchanged model. Each text is read with a beginning-of-text token in front, which is
        left out (the attention sink)."""
        import torch
        from .directions import _with_bos
        model, tok, mp = self.sess.require()
        got = {k: ([], []) for k in modules}
        hs = []

        def grab(key):
            def h(module, args, output):
                y = output[0] if isinstance(output, tuple) else output
                got[key][0].append(args[0][0, 1:].detach().float().cpu())
                got[key][1].append(y[0, 1:].detach().float().cpu())
            return h
        for key, mod in modules.items():
            hs.append(mod.register_forward_hook(grab(key)))
        try:
            with torch.no_grad():
                for t in texts:
                    ids = _with_bos(tok, t, self.device)
                    if ids.shape[1] > 1:
                        model(ids, use_cache=False)
        finally:
            for h in hs:
                h.remove()
        return {k: (torch.cat(xs), torch.cat(ys)) for k, (xs, ys) in got.items()}

    def stats(self):
        from .streamstats import resid_stats
        return resid_stats(self.sess)

    def pca(self, layer):
        from .streamstats import resid_pca
        return resid_pca(self.sess, layer)

    def pca_scales(self, layer):
        from .streamstats import resid_pca_scales
        return resid_pca_scales(self.sess, layer)

    def direction(self, name, lineno):
        d = self.dirs.get(name, lineno)
        return d.fit(self.mp.d_model, lineno) if self.mp is not None else d

    def reference_texts(self):
        from .means import corpus_passages
        return corpus_passages()

    def cache(self, kind, key):
        """A file for what a unit fits, under _tmp/means/, named for the model, its revision and
        precision, the reference corpus, and the unit's own key."""
        from .means import CACHE
        from .streamstats import _key
        CACHE.mkdir(parents=True, exist_ok=True)
        return CACHE / f"unit-{kind}-{_key(self.sess)}-{key}.pt"

    def memory(self, strip, layer):
        return self.run.store.setdefault((strip.lineno, layer), {})

    def positions(self, n, device):
        return self.run.positions(n, device)

    def prompt_length(self):
        return self.run.prompt_len

    def hook_stream(self, strip, make):
        from .interventions import _resid
        _resid(self.mp, strip.target()[1], strip, self.run, self.att, make)

    def hook_output(self, strip, module, fn):
        self.att.handles.append(module.register_forward_hook(self.run.watch(fn, "fwd")))

    def hook_input(self, strip, module, fn):
        self.att.handles.append(module.register_forward_pre_hook(self.run.watch(fn, "pre")))

    def on_restore(self, fn):
        self.att.restores.append(fn)

    def stream_code(self, strip, expr):
        from .interventions import _resid_lines
        return _resid_lines(self.mp, strip.target()[1], strip, expr)


def _check_needs(u: vau.Unit, s) -> None:
    if u.m["site"] == "logits" and u.m["level"] != "probe":
        from .interventions import ChainError
        raise ChainError(f"Line {s.lineno}: {name(u)} changes the logits; the bench reads them for meters but has no hook to change them yet.")
    missing = u.missing(CAPABILITIES)
    if missing:
        from .interventions import ChainError
        raise ChainError(f"Line {s.lineno}: {name(u)} needs {', '.join(missing)}, which the bench does not offer.")


def validate(s) -> None:
    from .interventions import ChainError
    u = unit(s.kind)
    try:
        vau.validate(u, s)
    except vau.UnitError as e:
        raise ChainError(str(e))
    import re
    if u.m["level"] == "probe" and u.m["site"] == "stream" and not re.fullmatch(r"\d+|emb", s.params.get("layer", "").strip().lower()):
        raise ChainError(f"Line {s.lineno}: {s.kind} reads one layer: layer=6, for example.")


def read(s, data):
    """A meter unit's readings for one text (vau.read)."""
    from .interventions import ChainError
    try:
        return vau.read(unit(s.kind), s, None, data)
    except vau.UnitError as e:
        raise ChainError(str(e))


def prepare(sess, chain, directions) -> None:
    """What the chain's units measure or fit, on the unchanged model, before any hook goes on."""
    host = BenchHost(sess, directions=directions)
    for s in chain.active:
        u = unit(s.kind)
        if u:
            _check_needs(u, s)
            vau.prepare(u, s, host)


def attach(s, sess, run, directions, att) -> None:
    u = unit(s.kind)
    _check_needs(u, s)
    vau.attach(u, s, BenchHost(sess, run, directions, att))


def code(s, mp) -> Dict[str, Any]:
    return vau.code(unit(s.kind), s, BenchHost(mp=mp))


# ---------------------------------------------------------------------------
# The host features on the bench's own stream strips
# ---------------------------------------------------------------------------
# Steer, Project out, Noise and Scale on the residual stream take the same host features as
# units (vau.hostfx): wet, an envelope over the depth, keep size, and a random control.

OWN = ("steer", "project", "noise", "scale")


class _Line:
    def __init__(self, s):
        self.params, self.lineno = s.params, s.lineno

    def error(self, msg):
        from .interventions import ChainError
        return ChainError(f"Line {self.lineno}: {msg}")


def takes_hostfx(s) -> bool:
    return bool(unit(s.kind)) or (s.kind in OWN and (s.kind != "scale" or s.target()[0] == "layer"))


def validate_own(s) -> None:
    """The host features on one of the bench's own strips: allowed only on its stream strips,
    and checked as a unit's are."""
    from .interventions import ChainError
    given = [k for k in vau.hostfx.RESERVED if k in s.params]
    if not given:
        return
    if not takes_hostfx(s):
        raise ChainError(f"Line {s.lineno}: {s.kind} does not take the host features ({', '.join(given)}); "
                         "they apply to units and to Steer, Project out, Noise and Scale on the residual stream.")
    for p in vau.hostfx.HOST_PARAMS:
        v = s.params.get(p["key"])
        if v is None:
            continue
        if p["kind"] == "choice" and v not in p["choices"]:
            raise ChainError(f"Line {s.lineno}: {p['key']} is " + " or ".join(p["choices"]) + ".")
    vau.hostfx.settings(_Line(s))
    if s.kind == "noise" and s.params.get("control", "none") != "none":
        raise ChainError(f"Line {s.lineno}: noise uses no direction, so a random control does nothing there.")


def own_settings(s):
    return vau.hostfx.settings(_Line(s))


def own_wrap(s, mp, make, ctx=None):
    """make(layer) -> edit, with the host features around each edit."""
    st = own_settings(s)
    if not vau.hostfx.active(st):
        return make
    n = mp.n_layers + 1 if st["env"] != "none" else None
    w = None
    if vau.hostfx.windowed(st) and ctx is not None:
        w = lambda k, device: vau.hostfx.window_mask(st, ctx.positions(k, device) - ctx.prompt_len + 2)
    return lambda layer: vau.hostfx.wrap_edit(make(layer), vau.hostfx.factor(st, layer, n), st["keepnorm"], w)


def own_direction(s, d, key: str = "dir"):
    st = own_settings(s)
    return vau.hostfx.RandomDirection(d, s.params[key], st["cseed"]) if st["control"] == "random" else d


def own_code(s) -> List[str]:
    st = own_settings(s)
    return [f"# host features: {vau.hostfx.describe(st)}"] if vau.hostfx.active(st) else []


def random_basis(name: str, seed: int, layer: int, k: int, d: int):
    """A random control for a subspace: k orthonormal random directions, drawn from the seed, the
    direction's name and the layer."""
    import hashlib as _h
    import torch
    g = torch.Generator().manual_seed(int(_h.sha256(f"{seed}:{name}:{layer}:subspace".encode()).hexdigest()[:15], 16))
    q, _ = torch.linalg.qr(torch.randn(d, k, generator=g))
    return q.T.contiguous()
