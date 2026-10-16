"""Time the raw MIGraphX API (FP16 or INT8) on a static ONNX export, at one batch size, in one process.

    python bench_migraphx.py --variant mgx_fp16 --model best.pt --images data/test_images --batch 1
    python bench_migraphx.py --variant mgx_int8 --calib data/calib_images ...
    python bench_migraphx.py --variant mgx_fp16 --engine ort-cpu ...     # check pre/post on any machine, no GPU

Pre- and post-processing use common.py's Ultralytics-exact letterbox and box scaling, so these rows differ from
`nmsfree` in the runtime only. Needs no PyTorch. Compiled programs are cached as .mxr next to the ONNX; the cache
name carries the precision, knobs and calibration set, so a changed set rebuilds by itself (or pass --rebuild).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import platform
import sys
import time
import traceback
from datetime import datetime
from importlib import metadata
from pathlib import Path

import numpy as np

import common as C


class Skip(Exception):
    pass


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--variant", required=True, help="mgx_fp16 or mgx_int8, optionally +knobs and @tags")
    p.add_argument("--model", default="best.pt", help="used to find <artifacts>/<stem>_b<B>_<imgsz>_fp32.onnx")
    p.add_argument("--onnx", default=None, help="explicit FP32 ONNX path instead")
    p.add_argument("--images", default="data/test_images")
    p.add_argument("--calib", default="", help="INT8 calibration images, kept apart from --images")
    p.add_argument("--calib-limit", type=int, default=128)
    p.add_argument("--batch", type=int, default=1)
    p.add_argument("--imgsz", type=int, default=800)
    p.add_argument("--iters", type=int, default=100)
    p.add_argument("--warmup", type=int, default=10)
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--gap-ms", type=float, default=0)
    p.add_argument("--tag", default="")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--out", default="results")
    p.add_argument("--artifacts", default="artifacts")
    p.add_argument("--engine", default="migraphx", choices=["migraphx", "ort-cpu"])
    p.add_argument("--rebuild", action="store_true", help="ignore a cached .mxr")
    p.add_argument("--no-accuracy", action="store_true")
    return p.parse_args()


def to_numpy(arg, batch: int) -> np.ndarray:
    """A MIGraphX output argument -> (batch, 300, 6) float32, via the buffer protocol or, failing that, tolist()."""
    try:
        a = np.asarray(arg)
        if a.dtype == object:  # no buffer protocol: numpy wrapped the object itself
            raise TypeError
    except Exception:
        a = np.asarray(arg.tolist())
    return a.astype(np.float32, copy=False).reshape(batch, -1, 6)


class MIGraphXRunner:
    def __init__(self, onnx: Path, n: C.Name, calib: list[np.ndarray], mxr: Path, rebuild: bool):
        import migraphx

        self.mx = migraphx
        target = migraphx.get_target("gpu")
        self.built = rebuild or not mxr.exists()
        if self.built:
            prog = migraphx.parse_onnx(str(onnx))
            name = self._input_name(prog)
            if n.variant == "mgx_int8":
                migraphx.quantize_int8(prog, target, [{name: migraphx.argument(b)} for b in calib])
            else:
                migraphx.quantize_fp16(prog)
            exhaustive = any(C.KNOBS[k].exhaustive_tune for k in n.knobs)
            prog.compile(target, offload_copy=True, exhaustive_tune=exhaustive)
            migraphx.save(prog, str(mxr))
        else:
            prog = migraphx.load(str(mxr))
        self.prog = prog
        self.input = self._input_name(prog)
        self.input_shape = list(prog.get_parameter_shapes()[self.input].lens())

    @staticmethod
    def _input_name(prog) -> str:
        names = list(prog.get_parameter_names())
        return "images" if "images" in names else next(x for x in names if "#output" not in x)

    def __call__(self, blob: np.ndarray) -> np.ndarray:
        out = self.prog.run({self.input: self.mx.argument(blob)})[0]  # offload_copy: synchronous, result on host
        return to_numpy(out, blob.shape[0])


class ORTCPURunner:
    """Stand-in engine to validate the pre/post-processing path on a machine without MIGraphX."""

    def __init__(self, onnx: Path):
        import onnxruntime as ort

        self.session = ort.InferenceSession(str(onnx), providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name
        self.input_shape = list(self.session.get_inputs()[0].shape)
        self.built = True

    def __call__(self, blob: np.ndarray) -> np.ndarray:
        return self.session.run(None, {self.input: blob})[0]


def run(n: C.Name, args, result: dict) -> None:
    onnx = Path(args.onnx) if args.onnx else Path(args.artifacts) / f"{Path(args.model).stem}_b{args.batch}_{args.imgsz}_fp32.onnx"
    if not onnx.exists():
        raise Skip(f"{onnx} not found; run export_onnx.py first")
    result["weights"] = str(onnx)
    S, B = args.imgsz, args.batch

    calib, calib_tag = [], ""
    if n.variant == "mgx_int8" and args.engine == "migraphx":
        if not args.calib or not Path(args.calib).is_dir():
            raise Skip("mgx_int8 needs --calib (a folder of images not in the test set)")
        cpaths = C.list_images(args.calib, args.calib_limit)
        cframes = [C.letterbox(f, S) for f in C.read_images(cpaths)]
        calib = [C.to_blob([cframes[i] for i in idx]) for idx, _ in C.eval_batches(len(cframes), B)]
        calib_tag = "_calib-" + hashlib.sha256("|".join(p.name for p in cpaths).encode()).hexdigest()[:8]
        result["calibration"] = {"folder": args.calib, "images": len(cpaths), "batches": len(calib)}

    paths = C.list_images(args.images, args.limit)
    frames = C.read_images(paths)
    batches = C.timing_batches(len(frames), B, 1 + args.warmup + args.iters)

    t0 = time.perf_counter()
    if args.engine == "ort-cpu":
        runner = ORTCPURunner(onnx)
        result["versions"] = {"onnxruntime": metadata.version("onnxruntime")}
    else:
        mxr = onnx.with_name(f"{onnx.stem}__{'+'.join([n.variant, *n.knobs])}{calib_tag}.mxr")
        runner = MIGraphXRunner(onnx, n, calib, mxr, args.rebuild)
        result["versions"] = {"migraphx": metadata.version("migraphx")}
        result["device"] = {"arch": C.gpu_arch_from_kfd()}
        result["mxr"] = str(mxr)
    if runner.input_shape[0] != B or runner.input_shape[2:] != [S, S]:
        raise RuntimeError(f"engine input is {runner.input_shape} but --batch {B} --imgsz {S}; use that batch's ONNX")

    def infer(idx):
        a = time.perf_counter()
        blob = C.to_blob([C.letterbox(frames[i], S) for i in idx])
        b = time.perf_counter()
        out = runner(blob)
        c = time.perf_counter()
        dets = [C.scale_boxes(d, (S, S), frames[i].shape[:2]) for d, i in zip(C.decode_end2end(out, args.conf), idx)]
        d = time.perf_counter()
        return dets, ((b - a) * 1e3 / B, (c - b) * 1e3 / B, (d - c) * 1e3 / B)

    infer(batches[0])
    result["cold_start"] = {
        ("compile_and_first_call_s" if runner.built else "load_and_first_call_s"): round(time.perf_counter() - t0, 3)
    }
    for idx in batches[1 : 1 + args.warmup]:
        infer(idx)

    times, stages = [], []
    for idx in batches[1 + args.warmup :]:
        if args.gap_ms:
            time.sleep(args.gap_ms / 1e3)
        t = time.perf_counter()
        _, st = infer(idx)
        times.append((time.perf_counter() - t) * 1e3)
        stages.append(st)
    lat = C.summarize_ms(times)
    result["latency_ms"] = lat
    result["img_per_s"] = round(B * 1e3 / lat["mean"], 2)
    result["stages_ms_per_image"] = dict(zip(("preprocess", "inference", "postprocess"), np.round(np.mean(stages, 0), 3).tolist()))

    if not args.no_accuracy:
        names, shapes, dets = [], [], []
        for idx, n_real in C.eval_batches(len(frames), B):
            d, _ = infer(idx)
            for i, di in zip(idx[:n_real], d[:n_real]):
                names.append(paths[i].name)
                shapes.append(frames[i].shape)
                dets.append(di)
        dets_file = Path(args.out) / "dets" / f"{result['stem']}.json"
        C.write_dets(dets_file, names, shapes, dets)
        result["dets_file"] = str(dets_file)


def main() -> int:
    args = parse_args()
    name = args.variant + (f"@gap{args.gap_ms:g}" if args.gap_ms else "") + (f"@{args.tag}" if args.tag else "")
    if args.engine == "ort-cpu":
        name += "@ortcpu"  # never mixed up with real MIGraphX rows
    n = C.parse_name(name)
    if n.runtime != "migraphx":
        raise SystemExit(f"{n.variant} runs in bench_ultralytics.py")
    os.environ.setdefault("MIGRAPHX_DISABLE_WINOGRAD", "1")  # same default as Ultralytics' EP path; the winograd knob flips it
    for k in n.knobs:
        os.environ.update(C.KNOBS[k].env)

    stem = C.stem(str(n), args.batch)
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
        "engine": args.engine,
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
    C.write_json(Path(args.out) / "runs" / f"{stem}.json", result)
    if result["status"] == "ok":
        lat = result["latency_ms"]
        print(f"{stem}: p50 {lat['p50']:.2f} ms  p95 {lat['p95']:.2f} ms  {result['img_per_s']} img/s")
    else:
        print(f"{stem}: {result['status']} - {result['reason']}")
    return 0 if result["status"] in ("ok", "skipped") else 1


if __name__ == "__main__":
    sys.exit(main())
