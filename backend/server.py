# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
The local server: serves the page on http://127.0.0.1:8774/ and holds the model.

As Video Kintsugi's server: it listens on 127.0.0.1 only, refuses a request whose Host
header is not this machine, refuses a write (POST, DELETE) without the header
`X-Abliteration: 1`, and runs one model job at a time.
"""
from __future__ import annotations

import json
import os
import queue
import re
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Dict

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from abliteration import ROOT, TOOL, VERSION
from abliteration import analysis as an
from abliteration import directions as dr
from abliteration.generate import baselines, make_recipe, sampler_defaults
from abliteration import vauhost
from abliteration import models as mdls
from abliteration.interventions import SPECS, ChainError, code_view, parse_chain
from abliteration.means import Means, corpus_passages
from abliteration.model import local_checkpoints, session

PORT = int(os.environ.get("ABLITERATION_PORT", "8774"))
HOST = "127.0.0.1"
WEB = ROOT / "web"

app = FastAPI(title=TOOL, version=VERSION, docs_url=None, redoc_url=None)
means = Means(session)
JOB = threading.Lock()
state: Dict[str, Any] = {"job": None, "started": None}


@app.middleware("http")
async def guard(request: Request, call_next):
    host = request.headers.get("host", "")
    if host not in (f"127.0.0.1:{PORT}", f"localhost:{PORT}"):
        return PlainTextResponse("Refused: this server only answers this machine.", status_code=403)
    if request.method in ("POST", "DELETE", "PUT") and request.headers.get("x-abliteration") != "1":
        return PlainTextResponse("Refused: a write needs the X-Abliteration header.", status_code=403)
    return await call_next(request)


def err(msg: str, code: int = 400):
    return JSONResponse({"error": msg}, status_code=code)


def busy():
    return err(f"The model is busy with {state['job']}. Stop it or wait.", 409)


def stream(job_name: str, fn):
    """Run fn(emit) in a thread holding the job lock; stream its events as NDJSON."""
    if not JOB.acquire(blocking=False):
        return busy()
    q: "queue.Queue" = queue.Queue()
    an.STOP.clear()
    state.update(job=job_name, started=time.time())

    def work():
        try:
            with session.lock:
                fn(q.put)
        except an.Stopped:
            q.put({"type": "stopped"})
        except (ChainError, ValueError, FileNotFoundError) as e:
            q.put({"type": "error", "error": str(e)})
        except Exception as e:
            traceback.print_exc()
            q.put({"type": "error", "error": f"{type(e).__name__}: {e}"})
        finally:
            state.update(job=None, started=None)
            JOB.release()
            q.put(None)

    threading.Thread(target=work, daemon=True).start()

    def gen():
        while True:
            e = q.get()
            if e is None:
                break
            yield json.dumps(e) + "\n"
    return StreamingResponse(gen(), media_type="application/x-ndjson")


def blocking(job_name: str, fn):
    if not JOB.acquire(blocking=False):
        return busy()
    state.update(job=job_name, started=time.time())
    try:
        with session.lock:
            return JSONResponse(fn())
    except (ChainError, ValueError, FileNotFoundError) as e:
        return err(str(e))
    except Exception as e:
        traceback.print_exc()
        return err(f"{type(e).__name__}: {e}", 500)
    finally:
        state.update(job=None, started=None)
        JOB.release()


# ---------------------------------------------------------------- status and models

@app.get("/api/status")
def status():
    return {"tool": TOOL, "version": VERSION, "model": session.info or None, "device": session.device,
            "job": state["job"], "job_seconds": (time.time() - state["started"]) if state["started"] else None}


@app.get("/api/presets")
def presets():
    models = mdls.presets()
    for p in models:
        p["cached"] = bool(local_checkpoints(p["id"]))
        p["revisions"] = [c["revision"] for c in local_checkpoints(p["id"])]
    return {"models": models}


@app.get("/api/models")
def models_list():
    """The presets and the supported models in the Hugging Face cache, read from this machine."""
    return mdls.listing()


@app.get("/api/models/{mid:path}/info")
def model_info(mid: str, revision: str = ""):
    """The deep dive on one model, from its files in the cache and its preset; nothing is downloaded."""
    try:
        return mdls.info(mid, revision.strip() or None)
    except KeyError:
        return err("No such model among the presets, in the Hugging Face cache or loaded.", 404)


@app.post("/api/models/fetch")
async def model_fetch(request: Request):
    """Read a model's public page and config.json from huggingface.co (only on a click in the
    page: the one route that leaves this machine without loading a model). Nothing is saved."""
    body = await request.json()
    try:
        return mdls.fetch((body.get("model") or "").strip())
    except ValueError as e:
        return err(str(e))


@app.get("/api/checkpoints")
def checkpoints(model: str):
    return {"checkpoints": local_checkpoints(model)}


@app.post("/api/load")
async def load(request: Request):
    body = await request.json()
    mid = (body.get("model") or "").strip()
    rev = (body.get("revision") or "").strip() or None
    if not mid:
        return err("Name a model.")
    def fn():
        info = session.load(mid, rev)
        baselines.clear()
        return {"model": info}
    return blocking(f"loading {mid}", fn)


# ---------------------------------------------------------------- the chain

@app.get("/api/strips")
def strips():
    return {"specs": SPECS}


@app.post("/api/chain")
async def chain(request: Request):
    body = await request.json()
    text = body.get("text", "")
    try:
        c = parse_chain(text)
    except ChainError as e:
        return {"ok": False, "error": str(e)}
    out = {"ok": True, "strips": [{"lineno": s.lineno, "kind": s.kind, "on": s.on, "params": s.params,
                                   "level": s.level} for s in c.strips]}
    if session.map is not None:
        out["code"] = code_view(c, session.map)
        for s in c.active:
            for n in vauhost.direction_names(s):
                try:
                    dr.registry.get(n, s.lineno)
                except ChainError as e:
                    out["ok"], out["error"] = False, str(e)
    return out


# ---------------------------------------------------------------- runs

def _run_args(body):
    return (body.get("prompt", ""), body.get("chain", ""), body.get("sampler") or {}, int(body.get("seed", 1)))


@app.post("/api/run")
async def run(request: Request):
    body = await request.json()
    prompt, chain_text, sampler, seed = _run_args(body)
    if not prompt.strip():
        return err("The prompt is empty.")
    if session.model is None:
        return err("Load a model first.")
    try:
        parse_chain(chain_text)
    except ChainError as e:
        return err(str(e))

    def fn(emit):
        an.paired(session, prompt, chain_text, sampler, seed, dr.registry, means,
                  parent=body.get("parent"), witness_of=body.get("witness_of"), label=body.get("label", ""),
                  save=body.get("save", True), emit=emit)
    return stream("a paired run", fn)


@app.post("/api/regenerate")
async def regenerate(request: Request):
    """Run a recipe again: load its model and revision, use the directions it carries,
    and report whether the texts match the run it came from."""
    body = await request.json()
    recipe = body.get("recipe") or {}
    original = body.get("original")
    if recipe.get("format") != "divergence-bench.recipe.v1":
        return err("Not a Abliteration Lens recipe.")

    def fn(emit):
        m = recipe["model"]
        if (session.info.get("model_id"), session.info.get("revision"), session.info.get("dtype")) != (
                m["model_id"], m.get("revision"), m.get("dtype")):
            emit({"type": "status", "text": f"Loading {m['model_id']} @ {m.get('revision')}"})
            session.load(m["model_id"], m.get("revision") if m.get("revision") != "main" else None, m.get("dtype"))
            baselines.clear()
            emit({"type": "model", "model": session.info})
        warn = []
        if m.get("revision_hash") and session.info.get("revision_hash") != m["revision_hash"]:
            warn.append(f"The weights' revision hash differs: recipe {m['revision_hash']}, "
                        f"loaded {session.info.get('revision_hash')}.")
        if m.get("device") != session.info.get("device"):
            warn.append(f"The recipe ran on {m.get('device')}; this is {session.info.get('device')}.")
        reg = dr.registry.with_embedded(recipe.get("directions"))
        baselines.clear()
        r = an.paired(session, recipe["prompt"], recipe["chain"]["text"], recipe["sampler"], recipe["seed"],
                      reg, means, witness_of=body.get("witness_of"), label=body.get("label", "regenerated"),
                      emit=emit)
        check = None
        if original:
            check = {"baseline_identical": original.get("baseline") == r["baseline"]["text"],
                     "bent_identical": original.get("bent") == r["bent"]["text"]}
        emit({"type": "regenerated", "check": check, "warnings": warn, "id": r["id"]})
    return stream("regenerating a recipe", fn)


@app.post("/api/stop")
def stop():
    an.STOP.set()
    return {"ok": True}


@app.get("/api/runs")
def runs():
    return {"runs": an.list_runs()}


@app.get("/api/runs/{rid}")
def get_run(rid: str):
    try:
        return an.load_run(rid)
    except (FileNotFoundError, ValueError):
        return err("No such run.", 404)


@app.delete("/api/runs/{rid}")
def del_run(rid: str):
    an.delete_run(rid)
    return {"ok": True}


@app.post("/api/runs/{rid}/meta")
async def run_meta(rid: str, request: Request):
    """Annotations and the label, written by the page."""
    body = await request.json()
    try:
        r = an.load_run(rid)
    except (FileNotFoundError, ValueError):
        return err("No such run.", 404)
    if "annotations" in body:
        r["annotations"] = body["annotations"]
    if "label" in body:
        r["label"] = body["label"]
    an.save_run(r)
    return {"ok": True}


@app.post("/api/runs/{rid}/band")
async def band(rid: str, request: Request):
    body = await request.json()
    n = max(2, min(int(body.get("n", 8)), 64))
    try:
        r = an.load_run(rid)
    except (FileNotFoundError, ValueError):
        return err("No such run.", 404)
    if r["recipe"]["model"]["model_id"] != session.info.get("model_id"):
        return err("Load the model this run used first.")

    def fn(emit):
        b = an.control_band(session, r, n, dr.registry, means, emit)
        r["band"] = b
        an.save_run(r)
        emit({"type": "band", "band": b})
    return stream("a control band", fn)


@app.get("/api/runs/{rid}/export.json")
def export_json(rid: str):
    r = an.export_json(an.load_run(rid))
    return Response(json.dumps(r, indent=1), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="abliteration-{rid}.json"'})


@app.get("/api/runs/{rid}/recipe.json")
def export_recipe(rid: str):
    r = an.load_run(rid)
    out = dict(r["recipe"], expected={"baseline": r["baseline"]["text"], "bent": r["bent"]["text"], "run": rid})
    return Response(json.dumps(out, indent=1), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="recipe-{rid}.json"'})


@app.get("/api/runs/{rid}/export.md")
def export_md(rid: str):
    return Response(an.export_markdown(an.load_run(rid)), media_type="text/markdown",
                    headers={"Content-Disposition": f'attachment; filename="abliteration-{rid}.md"'})


@app.post("/api/export/benchkit")
async def export_benchkit(request: Request):
    body = await request.json()
    ids = body.get("ids") or [r["id"] for r in an.list_runs()]
    return JSONResponse(an.export_benchkit([an.load_run(i) for i in ids]))


# ---------------------------------------------------------------- sweeps and maps

@app.post("/api/sweep")
async def sweep(request: Request):
    body = await request.json()
    prompt, chain_text, sampler, seed = _run_args(body)
    values = [float(v) for v in body.get("values", [])]
    if not values:
        return err("Give the values to sweep.")

    def fn(emit):
        res = an.dose_sweep(session, prompt, chain_text, sampler, seed, int(body["lineno"]), body["key"],
                            values, dr.registry, means, body.get("rule"), emit)
        res.update(id=time.strftime("%Y%m%d-%H%M%S"), prompt=prompt, chain=chain_text, seed=seed,
                   model=session.info, label=body.get("label", ""))
        d = ROOT / "runs" / "sweeps"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{res['id']}.json").write_text(json.dumps(res))
        emit({"type": "sweep", "sweep": res})
    return stream("a dose sweep", fn)


@app.post("/api/strip-sweep")
async def strip_sweep(request: Request):
    """One strip, alone, moved across every place its target can take, read teacher-forced on a
    text (a run's original text): loudness, mean KL and changed choices at each place."""
    body = await request.json()
    if session.model is None:
        return err("Load a model first.")
    prompt_ids = [int(x) for x in body.get("prompt_ids") or []]
    cont_ids = [int(x) for x in body.get("cont_ids") or []]
    if not prompt_ids or not cont_ids:
        return err("Run the pair first: the sweep reads the original text.")

    def fn(emit):
        from abliteration.loudness import sweep as sweep_strip
        res = sweep_strip(session, prompt_ids, cont_ids, body.get("line") or "", int(body.get("seed") or 0),
                          dr.registry, means, emit)
        emit({"type": "strip-sweep", "sweep": res})
    return stream("a sweep", fn)


@app.get("/api/sweeps")
def sweeps():
    d = ROOT / "runs" / "sweeps"
    out = []
    for p in sorted(d.glob("*.json"), reverse=True) if d.exists() else []:
        try:
            m = json.loads(p.read_text())
            out.append({"file": p.name, "key": m["key"], "lineno": m["lineno"], "chain": m.get("chain"),
                        "model": m["model"].get("model_id"), "breakdown": m.get("breakdown")})
        except Exception:
            pass
    return {"sweeps": out}


@app.get("/api/sweeps/{name}")
def get_sweep(name: str):
    if not re.fullmatch(r"[0-9A-Za-z_.-]+\.json", name):
        return err("Bad name.")
    p = ROOT / "runs" / "sweeps" / name
    return json.loads(p.read_text()) if p.exists() else err("No such sweep.", 404)


@app.post("/api/map")
async def cmap(request: Request):
    body = await request.json()

    def fn(emit):
        res = an.component_map(session, body.get("kind", "head-zero"), body.get("prompts") or [],
                               body.get("sampler") or {}, int(body.get("seed", 1)), float(body.get("k", 0)),
                               dr.registry, means, body.get("chain", ""), emit)
        maps = ROOT / "runs" / "maps"
        maps.mkdir(parents=True, exist_ok=True)
        res["id"] = time.strftime("%Y%m%d-%H%M%S")
        (maps / f"{res['id']}-{res['kind']}.json").write_text(json.dumps(res))
        emit({"type": "map", "map": res})
    return stream("a component map", fn)


@app.get("/api/maps")
def maps():
    d = ROOT / "runs" / "maps"
    out = []
    for p in sorted(d.glob("*.json"), reverse=True) if d.exists() else []:
        try:
            m = json.loads(p.read_text())
            out.append({"file": p.name, "kind": m["kind"], "model": m["model"].get("model_id"),
                        "revision": m["model"].get("revision"), "prompts": m["prompts"], "cells": len(m["cells"])})
        except Exception:
            pass
    return {"maps": out}


@app.get("/api/maps/{name}")
def get_map(name: str):
    if not re.fullmatch(r"[0-9A-Za-z_.-]+\.json", name):
        return err("Bad name.")
    p = ROOT / "runs" / "maps" / name
    return json.loads(p.read_text()) if p.exists() else err("No such map.", 404)


# ---------------------------------------------------------------- directions

@app.get("/api/directions")
def directions():
    return {"directions": [d.summary() for d in dr.registry.all()], "contrasts": dr.contrasts()}


@app.post("/api/directions/make")
async def make_direction(request: Request):
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", name):
        return err("A direction's name is letters, numbers, dots, dashes or underscores.")
    if session.model is None:
        return err("Load a model first.")

    def fn():
        layer = body.get("layer")
        layer = None if layer in (None, "") else int(layer)
        if body.get("kind") == "word":
            return {"direction": dr.registry.save(dr.from_word(session, name, body.get("word") or "")).summary()}
        if body.get("kind") == "combine":
            return {"direction": dr.registry.save(dr.combine(session, name, body.get("expr") or "", dr.registry)).summary()}
        if body.get("kind") == "decision":
            share = float(body.get("share") or 0.1)
            return {"direction": dr.registry.save(dr.from_decision(session, name, body.get("words") or "", body.get("texts") or [],
                                                                    layer, min(0.5, max(0.01, share)))).summary()}
        if body.get("kind") == "text":
            return {"direction": dr.registry.save(dr.from_text(session, name, body.get("texts") or [], layer)).summary()}
        if body.get("contrast"):
            c = next((x for x in dr.contrasts() if x["id"] == body["contrast"]), None)
            if not c:
                raise ValueError("No such contrast set.")
            pos, neg = c["positive"], c["negative"]
            source = {"kind": "contrast", "contrast": c["id"], "contrast_sha256": c["sha256"], "title": c["title"]}
        else:
            pos, neg = body.get("positive") or [], body.get("negative") or []
            source = {"kind": "pair" if len(pos) == 1 and len(neg) == 1 else "lists"}
        d = dr.extract(session, name, pos, neg, layer, source, body.get("method") or "mean")
        return {"direction": dr.registry.save(d).summary()}
    return blocking("making a direction", fn)


@app.post("/api/neurons/find")
async def neurons_find(request: Request):
    body = await request.json()
    if session.model is None:
        return err("Load a model first.")

    def fn():
        share = min(0.5, max(0.01, float(body.get("share") or 0.1)))
        return dr.find_neurons(session, body.get("words") or "", body.get("texts") or [], share, int(body.get("top") or 24))
    return blocking("finding neurons", fn)


@app.post("/api/directions/import")
async def import_direction(request: Request):
    body = await request.json()
    try:
        d = dr.from_import(body.get("data") or {}, (body.get("name") or "").strip() or None)
        return {"direction": dr.registry.save(d).summary()}
    except (ValueError, KeyError) as e:
        return err(str(e))


@app.get("/api/directions/{name}/export.json")
def export_direction(name: str):
    d = dr.registry.get(name)
    return Response(json.dumps(d.data), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}.direction.json"'})


@app.get("/api/directions/{name}/export.gguf")
def export_direction_gguf(name: str):
    """The direction as a llama.cpp control vector (layers 2 to n as direction.1 to direction.n-1)."""
    if session.model is None:
        return err("Load a model first.")
    d = dr.registry.get(name)
    out = ROOT / "_tmp" / f"{re.sub(r'[^A-Za-z0-9_.-]+', '-', name)}.gguf"
    out.parent.mkdir(parents=True, exist_ok=True)
    dr.to_gguf(session, d, out)
    return FileResponse(out, media_type="application/octet-stream", filename=f"{name}.gguf")


@app.post("/api/directions/import-gguf")
async def import_direction_gguf(request: Request):
    """A llama.cpp control vector (the file's bytes as the body; ?name= for its name)."""
    name = (request.query_params.get("name") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", name):
        return err("A direction's name is letters, numbers, dots, dashes or underscores.")
    if session.model is None:
        return err("Load a model first.")
    data = await request.body()
    tmp = ROOT / "_tmp" / f"import-{int(time.time() * 1000)}.gguf"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(data)
    try:
        return {"direction": dr.registry.save(dr.from_gguf(session, name, tmp)).summary()}
    except (ValueError, KeyError) as e:
        return err(str(e))
    finally:
        tmp.unlink(missing_ok=True)


@app.delete("/api/directions/{name}")
def delete_direction(name: str):
    dr.registry.delete(name)
    return {"ok": True}


@app.get("/api/corpus")
def corpus():
    return {"passages": corpus_passages()}


# ---------------------------------------------------------------- the page

@app.get("/units.js")
def units_js():
    """The units' manifests as a script the page loads before the desk (window.VAU)."""
    return Response("window.VAU = " + json.dumps(vauhost.catalogue()) + ";\n", media_type="text/javascript",
                    headers={"Cache-Control": "no-store"})


EXPLAIN_TYPES = {".js": "text/javascript", ".css": "text/css", ".json": "application/json"}


@app.get("/vau/explain/{name}")
def vau_explain(name: str):
    """A unit's explainer, the runtime that draws it, its styles or the example texts: only the
    files the installed vau names (vau.explain_files), for the built-in units and data/units."""
    path = vauhost.explain_files().get(name)
    if path is None:
        return PlainTextResponse("No such explainer file.", status_code=404)
    return FileResponse(path, media_type=EXPLAIN_TYPES.get(path.suffix, "text/plain"), headers={"Cache-Control": "no-cache"})


@app.get("/vau/look/{name}")
def vau_look(name: str):
    """The look of a collection's strips (core.css): only the files the installed vau names
    (vau.look_files)."""
    path = vauhost.look_files().get(name)
    if path is None:
        return PlainTextResponse("No such file.", status_code=404)
    return FileResponse(path, media_type=EXPLAIN_TYPES.get(path.suffix, "text/plain"), headers={"Cache-Control": "no-cache"})


@app.get("/api/units")
def units():
    return vauhost.catalogue()


@app.post("/api/units/rescan")
def units_rescan():
    vauhost.rescan()
    return vauhost.catalogue()


@app.get("/")
def index():
    # the scripts are named with the time of the latest edit, so a browser that cached an
    # earlier copy fetches the new one
    stamp = str(int(max(f.stat().st_mtime for f in WEB.iterdir())))
    html = (WEB / "index.html").read_text()
    for name in ("boxes.js", "desk.js", "app.js", "help.js", "workspace.js"):
        html = html.replace(f'src="{name}"', f'src="{name}?v={stamp}"')
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


class Page(StaticFiles):
    """The page's scripts and styles, which the browser must check again on every load,
    so that an edited script is never served from its cache."""

    async def get_response(self, path, scope):
        r = await super().get_response(path, scope)
        r.headers["Cache-Control"] = "no-cache"
        return r


app.mount("/", Page(directory=WEB), name="web")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
