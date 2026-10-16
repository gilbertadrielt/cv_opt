"""Time one Ultralytics variant (a .pt on PyTorch, or an .onnx on the MIGraphX EP) at one batch size, in one process.

    python bench_ultralytics.py --variant nmsfree --model best.pt --images data/test_images --batch 1
    python bench_ultralytics.py --variant tuned+nhwc --batch 8 ...      # a ROCm knob on top of a rung
    python bench_ultralytics.py --variant tuned --tune --batch 8 ...    # MIOpen tuning pass: fills the perf DB only

The clock starts with decoded BGR frames in memory and stops when boxes in original-image pixels are on the CPU.
Env vars that must exist before torch loads (MIOpen DB paths, knob settings) are set in configure_env(), so run
one variant per process and never import torch above it.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import sys
import time
import traceback
from contextlib import nullcontext
from datetime import datetime
from pathlib import Path

import common as C

# Predict arguments each rung adds, applied root first along the ladder.
STEP_KWARGS = {
    "baseline": {"rect": True, "nms": None},
    "fp16": {"quantize": 16},
    "static": {"rect": False},
    "nmsfree": {"nms": False},
    "compile": {"compile": "default"},
    "compile_graphs": {"compile": "reduce-overhead"},
}


class Skip(Exception):
    """The variant cannot run on this stack; recorded as `skipped` with the reason."""


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--variant", required=True, help="variant[+knob...][@tag...], e.g. nmsfree or tuned+nhwc")
    p.add_argument("--model", default="best.pt", help=".pt checkpoint; ONNX variants look up its export in --artifacts")
    p.add_argument("--images", default="data/test_images")
    p.add_argument("--batch", type=int, default=1)
    p.add_argument("--imgsz", type=int, default=800)
    p.add_argument("--iters", type=int, default=100, help="timed batches")
    p.add_argument("--warmup", type=int, default=10, help="untimed batches after a warm-up pass over every image")
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--iou", type=float, default=0.7, help="NMS IoU, where NMS runs")
    p.add_argument("--device", default="0")
    p.add_argument("--gap-ms", type=float, default=0, help="idle time between timed batches (line cadence)")
    p.add_argument("--tag", default="", help="free label appended to the run name, e.g. contended")
    p.add_argument("--limit", type=int, default=0, help="use only the first N images (smoke tests)")
    p.add_argument("--out", default="results")
    p.add_argument("--cache", default=".cache", help="MIOpen DB/kernels, TunableOp and MIGraphX EP caches")
    p.add_argument("--artifacts", default="artifacts", help="ONNX exports")
    p.add_argument("--no-accuracy", action="store_true", help="skip the detection dump used for agreement metrics")
    p.add_argument("--profile", type=int, default=0, help="also profile N batches with torch.profiler")
    p.add_argument("--tune", action="store_true", help="MIOpen tuning pass for this config; writes no result row")
    p.add_argument("--tune-level", type=int, default=3, choices=(3, 4), help="MIOPEN_FIND_ENFORCE: 3 incremental, 4 exhaustive")
    return p.parse_args()


def run_name(args) -> C.Name:
    name = args.variant
    if args.gap_ms:
        name += f"@gap{args.gap_ms:g}"
    if args.tag:
        name += f"@{args.tag}"
    n = C.parse_name(name)
    if n.runtime == "migraphx":
        raise SystemExit(f"{n.variant} runs in bench_migraphx.py")
    return n


def configure_env(n: C.Name, args, stem: str) -> None:
    """Everything that has to be in the environment before torch, MIOpen or the MIGraphX EP load."""
    cache = Path(args.cache).resolve()
    os.environ["YOLO_AUTOINSTALL"] = "False"  # Ultralytics would otherwise pip-install its pinned ROCm 10.0 EP mid-run
    os.environ.setdefault("MIOPEN_CUSTOM_CACHE_DIR", str(cache / "miopen-kcache"))  # compiled kernels: cold start only
    tuned = "tuned" in n.steps
    if args.tune:
        if not tuned:
            raise SystemExit("--tune is for 'tuned' and the rungs after it")
        os.environ["MIOPEN_FIND_ENFORCE"] = str(args.tune_level)
        os.environ["MIOPEN_FIND_MODE"] = "1"  # NORMAL: full Find, so every solver is benchmarked
        os.environ["MIOPEN_USER_DB_PATH"] = str(cache / "miopen-db")
    elif tuned:
        os.environ["MIOPEN_USER_DB_PATH"] = str(cache / "miopen-db")
    else:  # rungs before `tuned` start from an empty user DB every time, so re-runs stay comparable
        fresh = Path(args.out).resolve() / "_miopen_fresh" / stem
        shutil.rmtree(fresh, ignore_errors=True)
        fresh.mkdir(parents=True)
        os.environ["MIOPEN_USER_DB_PATH"] = str(fresh)
    for k in n.knobs:
        for key, val in C.KNOBS[k].env.items():
            os.environ[key] = val.format(cache=cache)
    if "tunableop" in n.knobs:
        (cache / "tunableop").mkdir(parents=True, exist_ok=True)
    if n.runtime == "onnx":  # one compiled-program cache per config, so a knob never reuses another's engine
        os.environ["ORT_MIGRAPHX_CACHE_DIR"] = str(cache / "migraphx-ep" / "+".join([n.variant, *n.knobs]))


def predict_kwargs(n: C.Name, args, cfg: dict) -> dict:
    kw = {"imgsz": args.imgsz, "conf": args.conf, "iou": args.iou, "device": args.device, "batch": args.batch}
    kw.update(verbose=False, save=False)
    for step in n.steps:
        kw.update(STEP_KWARGS.get(step, {}))
    for k in n.knobs:
        if C.KNOBS[k].channels_last:
            kw["channels_last"] = True
        if C.KNOBS[k].compile_mode:
            kw["compile"] = C.KNOBS[k].compile_mode
    for key in ("nms", "compile", "channels_last"):
        if key in kw and key not in cfg:
            raise Skip(f"this Ultralytics has no '{key}' predict argument; pip install -U ultralytics")
    if "quantize" not in cfg and "quantize" in kw:  # releases before `quantize` replaced `half`
        kw["half"] = kw.pop("quantize") == 16
    if n.runtime == "onnx":  # precision and head are baked into the export
        for key in ("quantize", "half", "compile", "channels_last"):
            kw.pop(key, None)
    return kw


def onnx_path(args) -> Path:
    return Path(args.artifacts) / f"{Path(args.model).stem}_b{args.batch}_{args.imgsz}_fp16.onnx"


def capture_hip_graph(model, batch: int, imgsz: int) -> dict:
    """Replace the PyTorch backend's forward with a HIP-graph replay of it.

    Ultralytics still letterboxes and post-processes as usual; only the network forward replays. Needs fixed input
    shapes, which the ladder guarantees from `static` on (rect=False, every call gets exactly `batch` images).
    """
    import torch

    backend = model.predictor.model.backend
    forward = backend.forward
    dtype = torch.float16 if backend.fp16 else torch.float32
    t0 = time.perf_counter()
    with torch.inference_mode():
        static_in = torch.zeros(batch, 3, imgsz, imgsz, device=model.predictor.device, dtype=dtype)
        side = torch.cuda.Stream()
        side.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(side):  # warm up off the capture stream, as torch.cuda.graph requires
            for _ in range(3):
                forward(static_in)
        torch.cuda.current_stream().wait_stream(side)
        graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(graph):
            static_out = forward(static_in)
    torch.cuda.synchronize()

    def replay(im, *args, **kwargs):
        if im.shape != static_in.shape or im.dtype != static_in.dtype:
            raise RuntimeError(f"graph captured for {tuple(static_in.shape)} {static_in.dtype}, got {tuple(im.shape)} {im.dtype}")
        static_in.copy_(im)
        graph.replay()
        return static_out  # reused next replay; post-processing copies what it keeps first

    backend.forward = replay
    return {"capture_s": round(time.perf_counter() - t0, 3)}


def summarize_trace(trace: Path, n_batches: int) -> dict:
    """Kernel count per batch, GPU busy share and top kernels from a torch.profiler Chrome trace."""
    events = json.loads(trace.read_text(encoding="utf-8")).get("traceEvents", [])
    kernels = [e for e in events if e.get("ph") == "X" and e.get("cat") == "kernel"]
    copies = [e for e in events if e.get("ph") == "X" and e.get("cat") in ("gpu_memcpy", "gpu_memset")]
    if not kernels:
        return {"note": "no GPU kernel events in the trace (profiler has no GPU activity support here)"}
    busy = sum(e["dur"] for e in kernels)
    span = max(e["ts"] + e["dur"] for e in kernels) - min(e["ts"] for e in kernels)
    by_name = {}
    for e in kernels:
        by_name[e["name"]] = by_name.get(e["name"], 0.0) + e["dur"]
    top = sorted(by_name.items(), key=lambda kv: -kv[1])[:10]
    return {
        "kernels_per_batch": round(len(kernels) / n_batches, 1),
        "gpu_busy_pct": round(100 * busy / span, 1) if span else None,
        "kernel_ms_per_batch": round(busy / 1e3 / n_batches, 3),
        "copy_ms_per_batch": round(sum(e["dur"] for e in copies) / 1e3 / n_batches, 3),
        "top_kernels": [{"name": k[:120], "ms_per_batch": round(v / 1e3 / n_batches, 3)} for k, v in top],
    }


def run(n: C.Name, args, result: dict) -> None:
    import numpy as np
    import torch
    import ultralytics
    from ultralytics import YOLO
    from ultralytics.cfg import DEFAULT_CFG_DICT

    cuda = args.device != "cpu"
    if cuda and not torch.cuda.is_available():
        raise RuntimeError("PyTorch cannot see the GPU (run env_check.py)")
    torch.backends.cudnn.benchmark = "tuned" in n.steps  # MIOpen Find on ROCm; immediate mode when False
    result["versions"] = {"torch": torch.__version__, "hip": torch.version.hip, "ultralytics": ultralytics.__version__}
    if cuda:
        props = torch.cuda.get_device_properties(0)
        result["device"] = {"name": props.name, "arch": getattr(props, "gcnArchName", None)}

    kwargs = predict_kwargs(n, args, DEFAULT_CFG_DICT)
    result["predict_kwargs"] = {k: v for k, v in kwargs.items() if k not in ("verbose", "save")}
    weights = Path(args.model)
    if n.runtime == "onnx":
        weights = onnx_path(args)
        if not weights.exists():
            raise Skip(f"{weights} not found; run export_onnx.py first")
    result["weights"] = str(weights)

    paths = C.list_images(args.images, args.limit)
    frames = C.read_images(paths)
    batches = C.timing_batches(len(frames), args.batch, 1 + args.warmup + args.iters)
    sync = torch.cuda.synchronize if cuda else (lambda: None)
    high = any(C.KNOBS[k].high_priority for k in n.knobs)
    stream = torch.cuda.Stream(priority=torch.cuda.Stream.priority_range()[1]) if high else None

    def predict(idx):
        with torch.cuda.stream(stream) if stream else nullcontext():
            res = model.predict([frames[i] for i in idx], **kwargs)
            return res, [r.boxes.data.cpu().numpy() for r in res]  # boxes on the CPU stops the clock

    # Cold start: load, first call (weights to GPU, MIOpen Find, compile), graph capture.
    t0 = time.perf_counter()
    model = YOLO(str(weights), task="detect")
    predict(batches[0])
    sync()
    cold = {"load_and_first_call_s": round(time.perf_counter() - t0, 3)}
    if "hipgraph" in n.steps:
        cold.update(capture_hip_graph(model, args.batch, args.imgsz))
    result["cold_start"] = cold

    # Warm-up: one pass over every image, so rect=True rungs have met every input shape (each new shape pays kernel
    # selection once), then --warmup batches in timing order. A tuning pass needs exactly this and nothing more.
    for idx, _ in C.eval_batches(len(frames), args.batch):
        predict(idx)
    for idx in batches[1 : 1 + args.warmup]:
        predict(idx)
    sync()
    if args.tune:
        result["tuned_db"] = os.environ["MIOPEN_USER_DB_PATH"]
        return

    if "compile" in n.steps:  # Ultralytics falls back to eager quietly, so prove a graph was built
        from torch._dynamo.utils import counters

        graphs = counters["stats"]["unique_graphs"]
        result["compile"] = {"mode": kwargs["compile"], "unique_graphs": graphs, "graph_breaks": sum(counters["graph_break"].values())}
        if not graphs:
            raise RuntimeError("torch.compile built no graph; the model ran eagerly (see the log for the fallback reason)")
    if n.runtime == "onnx":  # a MIGraphX failure silently drops Ultralytics to the CPU provider
        providers = model.predictor.model.backend.session.get_providers()
        result["onnx_providers"] = providers
        if not any("MIGraphX" in p for p in providers):
            raise RuntimeError(f"ONNX Runtime is not on the MIGraphX EP: {providers}")

    times, stages = [], []
    for idx in batches[1 + args.warmup :]:
        if args.gap_ms:
            time.sleep(args.gap_ms / 1e3)
        sync()
        t = time.perf_counter()
        res, _ = predict(idx)
        sync()
        times.append((time.perf_counter() - t) * 1e3)
        stages.append(res[0].speed)
    lat = C.summarize_ms(times)
    result["latency_ms"] = lat
    result["img_per_s"] = round(args.batch * 1e3 / lat["mean"], 2)
    result["stages_ms_per_image"] = {k: round(float(np.mean([s[k] for s in stages])), 3) for k in stages[0]}

    if not args.no_accuracy:
        names, shapes, dets = [], [], []
        for idx, n_real in C.eval_batches(len(frames), args.batch):
            _, d = predict(idx)
            for i, di in zip(idx[:n_real], d[:n_real]):
                names.append(paths[i].name)
                shapes.append(frames[i].shape)
                dets.append(di)
        dets_file = Path(args.out) / "dets" / f"{result['stem']}.json"
        C.write_dets(dets_file, names, shapes, dets)
        result["dets_file"] = str(dets_file)

    if args.profile and cuda:
        from torch.profiler import ProfilerActivity, profile

        trace = Path(args.out) / "traces" / f"{result['stem']}.json"
        trace.parent.mkdir(parents=True, exist_ok=True)
        with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA]) as prof:
            for idx in batches[1 + args.warmup :][: args.profile]:
                predict(idx)
            sync()
        prof.export_chrome_trace(str(trace))
        result["profile"] = {"trace": str(trace), **summarize_trace(trace, args.profile)}


def main() -> int:
    args = parse_args()
    n = run_name(args)
    stem = C.stem(str(n), args.batch)
    configure_env(n, args, stem)
    result = {
        "name": str(n),
        "stem": stem,
        "variant": n.variant,
        "knobs": list(n.knobs),
        "tags": list(n.tags),
        "runtime": n.runtime,
        "parent": C.parent_name(str(n)),
        "adds": C.describe(str(n)),
        "batch": args.batch,
        "imgsz": args.imgsz,
        "conf": args.conf,
        "iters": args.iters,
        "warmup": args.warmup,
        "gap_ms": args.gap_ms,
        "images": args.images,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "host": platform.node(),
        "env": C.env_snapshot(),
        "system": C.system_state(),
    }
    print(f"{stem}: {result['adds']}", flush=True)
    try:
        run(n, args, result)
        result["status"] = "ok"
    except Skip as e:
        result.update(status="skipped", reason=str(e))
    except Exception as e:
        result.update(status="failed", reason=f"{type(e).__name__}: {e}"[:500], traceback=traceback.format_exc())
        traceback.print_exc()

    if args.tune:
        C.write_json(Path(args.out) / "tune" / f"{stem}.json", result)
        print(f"tuning pass {result['status']}: {result.get('reason', result.get('tuned_db'))}")
    else:
        C.write_json(Path(args.out) / "runs" / f"{stem}.json", result)
        lat = result.get("latency_ms", {})
        if result["status"] == "ok":
            print(f"{stem}: p50 {lat['p50']:.2f} ms  p95 {lat['p95']:.2f} ms  {result['img_per_s']} img/s")
        else:
            print(f"{stem}: {result['status']} - {result['reason']}")
    return 0 if result["status"] in ("ok", "skipped") else 1


if __name__ == "__main__":
    sys.exit(main())
