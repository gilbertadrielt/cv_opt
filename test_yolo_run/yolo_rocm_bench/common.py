"""Shared code for the YOLO26 ROCm latency harness.

Imports no torch, so the raw MIGraphX runner can use it from a venv without PyTorch. Holds the variant ladder and
ROCm knobs, Ultralytics-exact letterbox geometry, end-to-end output decoding, timing statistics, result files and
the box-agreement metrics report.py uses.

    python common.py runtime tuned+nhwc   # prints the runtime a run name belongs to (used by run_all.sh)
    python common.py selftest             # checks letterbox/box scaling against Ultralytics, if it is installed
"""

from __future__ import annotations

import json
import os
import platform
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
PAD_VALUE = 114  # Ultralytics' letterbox fill

# Env vars that change which kernels run or how they launch; every result records the ones that are set.
ENV_PREFIXES = (
    "HSA_", "HIP_", "ROCR_", "ROCBLAS_", "HIPBLASLT_", "MIOPEN_", "MIGRAPHX_", "ORT_MIGRAPHX_",
    "PYTORCH_", "TORCH_", "AMD_", "GPU_MAX_HW_QUEUES", "YOLO_",
)


# --------------------------------------------------------------------------------------------------------------------
# Ladder and knobs
# --------------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Variant:
    runtime: str  # "torch" (Ultralytics on a .pt), "onnx" (Ultralytics on the MIGraphX EP) or "migraphx" (raw API)
    parent: str | None  # the rung this one adds exactly one change to
    adds: str


# Each rung adds one change to its parent, so every report row is one method's marginal gain and accuracy cost.
VARIANTS = {
    "baseline": Variant("torch", None, "FP32, Ultralytics defaults (rect=True, NMS on), untuned MIOpen"),
    "fp16": Variant("torch", "baseline", "quantize=16"),
    "static": Variant("torch", "fp16", "fixed imgsz x imgsz input (rect=False)"),
    "tuned": Variant("torch", "static", "MIOpen Find (cudnn.benchmark) + tuned perf DB"),
    "nmsfree": Variant("torch", "tuned", "one-to-one NMS-free head (nms=False)"),
    "hipgraph": Variant("torch", "nmsfree", "HIP graph replay of the eager network"),
    "compile": Variant("torch", "nmsfree", "torch.compile, Inductor 'default' mode"),
    "compile_graphs": Variant("torch", "compile", "torch.compile 'reduce-overhead' (Inductor + HIP graphs)"),
    "migraphx_ep": Variant("onnx", "nmsfree", "FP16 ONNX on the MIGraphX EP, through Ultralytics"),
    "mgx_fp16": Variant("migraphx", "nmsfree", "raw MIGraphX API, FP32 ONNX quantized to FP16"),
    "mgx_int8": Variant("migraphx", "mgx_fp16", "raw MIGraphX API, INT8 calibrated on separate images"),
}


@dataclass(frozen=True)
class Knob:
    runtimes: frozenset
    adds: str
    env: dict = field(default_factory=dict)  # values may use {cache}
    channels_last: bool = False
    high_priority: bool = False
    compile_mode: str | None = None
    exhaustive_tune: bool = False


# ROCm-level settings tried on top of a rung. A knob row is compared against the same rung without the knob.
KNOBS = {
    "hipblaslt": Knob(
        frozenset({"torch"}),
        "GEMMs on hipBLASLt",
        {"TORCH_BLAS_PREFER_HIPBLASLT": "1", "ROCBLAS_USE_HIPBLASLT": "1"},
    ),
    "tunableop": Knob(
        frozenset({"torch"}),
        "PyTorch TunableOp GEMM tuning (tunes during warm-up)",
        {
            "PYTORCH_TUNABLEOP_ENABLED": "1",
            "PYTORCH_TUNABLEOP_TUNING": "1",
            "PYTORCH_TUNABLEOP_FILENAME": "{cache}/tunableop/results%d.csv",
        },
    ),
    "nhwc": Knob(
        frozenset({"torch"}),
        "channels_last + MIOpen NHWC kernels",
        {"PYTORCH_MIOPEN_SUGGEST_NHWC": "1", "PYTORCH_MIOPEN_SUGGEST_NHWC_BATCHNORM": "1"},
        channels_last=True,
    ),
    "autotune": Knob(frozenset({"torch"}), "torch.compile 'max-autotune-no-cudagraphs'", compile_mode="max-autotune-no-cudagraphs"),
    "hiprio": Knob(frozenset({"torch"}), "inference on a high-priority HIP stream", high_priority=True),
    "nosdma": Knob(frozenset({"torch", "onnx", "migraphx"}), "copies by blit kernels, not SDMA engines", {"HSA_ENABLE_SDMA": "0"}),
    "exhaustive": Knob(
        frozenset({"onnx", "migraphx"}),
        "MIGraphX exhaustive kernel tuning",
        {"ORT_MIGRAPHX_EXHAUSTIVE_TUNE": "1"},
        exhaustive_tune=True,
    ),
    "mlirtune": Knob(frozenset({"onnx", "migraphx"}), "exhaustive rocMLIR tuning", {"MIGRAPHX_MLIR_TUNE_EXHAUSTIVE": "1"}),
    "winograd": Knob(
        frozenset({"onnx", "migraphx"}),
        "Winograd convolutions on (off by default here, as in Ultralytics)",
        {"MIGRAPHX_DISABLE_WINOGRAD": "0"},
    ),
}


def chain(variant: str) -> list[str]:
    """Rungs from baseline down to `variant`, root first."""
    out = []
    while variant:
        out.append(variant)
        variant = VARIANTS[variant].parent
    return out[::-1]


@dataclass(frozen=True)
class Name:
    """A run name: `variant[+knob...][@tag...]`, e.g. `tuned+nhwc@gap200`."""

    variant: str
    knobs: tuple = ()
    tags: tuple = ()

    def __str__(self) -> str:
        return "".join([self.variant, *(f"+{k}" for k in self.knobs), *(f"@{t}" for t in self.tags)])

    @property
    def runtime(self) -> str:
        return VARIANTS[self.variant].runtime

    @property
    def steps(self) -> list[str]:
        return chain(self.variant)


def parse_name(name: str) -> Name:
    head, *tags = name.split("@")
    variant, *knobs = head.split("+")
    if variant not in VARIANTS:
        raise ValueError(f"unknown variant '{variant}', expected one of {', '.join(VARIANTS)}")
    for k in knobs:
        if k not in KNOBS:
            raise ValueError(f"unknown knob '{k}', expected one of {', '.join(KNOBS)}")
        if VARIANTS[variant].runtime not in KNOBS[k].runtimes:
            raise ValueError(f"knob '{k}' does not apply to '{variant}' ({VARIANTS[variant].runtime} runtime)")
        if KNOBS[k].compile_mode and "compile" not in chain(variant):
            raise ValueError(f"knob '{k}' needs a torch.compile rung (compile, compile_graphs)")
    if any(not re.fullmatch(r"[\w.-]+", t) for t in tags):
        raise ValueError(f"tags may only use letters, digits, '.', '-' and '_': {tags}")
    return Name(variant, tuple(knobs), tuple(tags))


def parent_name(name: str) -> str | None:
    """What a run is compared against: drop the last tag, else the last knob, else step up the ladder."""
    n = parse_name(name)
    if n.tags:
        return str(Name(n.variant, n.knobs, n.tags[:-1]))
    if n.knobs:
        return str(Name(n.variant, n.knobs[:-1]))
    return VARIANTS[n.variant].parent


def describe(name: str) -> str:
    n = parse_name(name)
    if n.tags:
        return f"same, tagged '{n.tags[-1]}'"
    if n.knobs:
        return KNOBS[n.knobs[-1]].adds
    return VARIANTS[n.variant].adds


def stem(name: str, batch: int) -> str:
    return f"{name}_b{batch}"


# --------------------------------------------------------------------------------------------------------------------
# Images, labels, batches
# --------------------------------------------------------------------------------------------------------------------


def list_images(folder: str | Path, limit: int = 0) -> list[Path]:
    folder = Path(folder)
    if not folder.is_dir():
        raise SystemExit(f"image folder not found: {folder}")
    paths = sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not paths:
        raise SystemExit(f"no images in {folder}")
    return paths[:limit] if limit else paths


def read_images(paths: list[Path]) -> list[np.ndarray]:
    frames = []
    for p in paths:
        im = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if im is None:
            raise SystemExit(f"could not decode {p}")
        frames.append(im)
    return frames


def read_labels(label_dir: str | Path, image_name: str, shape_hw) -> np.ndarray:
    """YOLO .txt labels for one image as (N, 6) rows [x1, y1, x2, y2, 1.0, cls] in original pixels."""
    f = Path(label_dir) / f"{Path(image_name).stem}.txt"
    if not f.exists():
        return np.zeros((0, 6), np.float32)
    rows = [line.split() for line in f.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = np.array([r[:5] for r in rows if len(r) >= 5], np.float32).reshape(-1, 5)
    h, w = shape_hw
    cls, cx, cy, bw, bh = rows.T
    xyxy = np.stack([(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h], 1)
    return np.concatenate([xyxy, np.ones((len(rows), 1), np.float32), cls[:, None]], 1)


def timing_batches(n_images: int, batch: int, count: int) -> list[list[int]]:
    """`count` full batches of image indices, cycling through the set so every call gets exactly `batch` images."""
    idx = [i % n_images for i in range(count * batch)]
    return [idx[i : i + batch] for i in range(0, len(idx), batch)]


def eval_batches(n_images: int, batch: int) -> list[tuple[list[int], int]]:
    """Batches covering every image once; the last is padded with repeats. Returns (indices, n_real)."""
    out = []
    for start in range(0, n_images, batch):
        real = list(range(start, min(start + batch, n_images)))
        pad = [i % n_images for i in range(batch - len(real))]
        out.append((real + pad, len(real)))
    return out


# --------------------------------------------------------------------------------------------------------------------
# Ultralytics-exact pre/post-processing (fixed-size letterbox, as used from the `static` rung on)
# --------------------------------------------------------------------------------------------------------------------


def letterbox_params(shape_hw, imgsz: int):
    """Same geometry as ultralytics.data.augment.LetterBox(auto=False, center=True). Returns ((w, h), (t, b, l, r))."""
    h, w = shape_hw
    r = min(imgsz / h, imgsz / w)
    new_unpad = (round(w * r), round(h * r))
    dw, dh = (imgsz - new_unpad[0]) / 2, (imgsz - new_unpad[1]) / 2
    return new_unpad, (round(dh - 0.1), round(dh + 0.1), round(dw - 0.1), round(dw + 0.1))


def letterbox(img: np.ndarray, imgsz: int) -> np.ndarray:
    new_unpad, (top, bottom, left, right) = letterbox_params(img.shape[:2], imgsz)
    if (img.shape[1], img.shape[0]) != new_unpad:
        img = cv2.resize(img, new_unpad, interpolation=cv2.INTER_LINEAR)
    return cv2.copyMakeBorder(img, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(PAD_VALUE,) * 3)


def to_blob(letterboxed: list[np.ndarray]) -> np.ndarray:
    """BGR HWC uint8 frames -> contiguous float32 RGB NCHW in 0..1, the network input."""
    x = np.stack(letterboxed)[..., ::-1].transpose(0, 3, 1, 2)
    return np.ascontiguousarray(x, dtype=np.float32) / 255.0


def decode_end2end(out: np.ndarray, conf: float, max_det: int = 300) -> list[np.ndarray]:
    """One-to-one head output (B, 300, 6) [x1, y1, x2, y2, score, cls] -> per-image rows above `conf`."""
    return [o[o[:, 4] > conf][:max_det].astype(np.float32) for o in out]


def scale_boxes(dets: np.ndarray, in_hw, orig_hw) -> np.ndarray:
    """Letterboxed-pixel boxes -> original-image pixels, clipped. Mirrors ultralytics.utils.ops.scale_boxes."""
    h0, w0 = orig_hw
    gain = min(in_hw[0] / h0, in_hw[1] / w0)
    new_h, new_w = round(h0 * gain), round(w0 * gain)
    gy, gx = new_h / h0, new_w / w0
    px, py = round((in_hw[1] - new_w) / 2 - 0.1), round((in_hw[0] - new_h) / 2 - 0.1)
    d = dets.copy()
    d[:, [0, 2]] = ((d[:, [0, 2]] - px) / gx).clip(0, w0)
    d[:, [1, 3]] = ((d[:, [1, 3]] - py) / gy).clip(0, h0)
    return d


# --------------------------------------------------------------------------------------------------------------------
# Statistics, result files, system state
# --------------------------------------------------------------------------------------------------------------------


def summarize_ms(values) -> dict:
    a = np.asarray(values, np.float64)
    if a.size == 0:
        return {}
    p50, p95, p99 = np.percentile(a, [50, 95, 99])
    return {
        "p50": round(p50, 3),
        "p95": round(p95, 3),
        "p99": round(p99, 3),
        "mean": round(a.mean(), 3),
        "std": round(a.std(), 3),
        "min": round(a.min(), 3),
        "max": round(a.max(), 3),
        "n": int(a.size),
    }


def write_json(path: str | Path, obj) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, indent=2, default=str), encoding="utf-8")
    tmp.replace(path)


def write_dets(path: str | Path, names: list[str], shapes: list, dets: list[np.ndarray]) -> None:
    write_json(
        path,
        {
            "shapes": {n: list(s[:2]) for n, s in zip(names, shapes)},
            "dets": {n: np.round(d[:, :6], 2).tolist() for n, d in zip(names, dets)},
        },
    )


def load_dets(path: str | Path) -> tuple[dict, dict] | None:
    path = Path(path)
    if not path.exists():
        return None
    d = json.loads(path.read_text(encoding="utf-8"))
    return {k: np.asarray(v, np.float32).reshape(-1, 6) for k, v in d["dets"].items()}, d["shapes"]


def env_snapshot() -> dict:
    return {k: v for k, v in sorted(os.environ.items()) if k.startswith(ENV_PREFIXES)}


def _read(path) -> str | None:
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return None


def system_state() -> dict:
    """Power and clock state that moves latency: GPU performance level, power profile, CPU governor, platform profile."""
    state = {"kernel": platform.release()}
    for card in sorted(Path("/sys/class/drm").glob("card*")):
        dev = card / "device"
        if not re.fullmatch(r"card\d+", card.name) or _read(dev / "vendor") != "0x1002":
            continue
        profile = _read(dev / "pp_power_profile_mode") or ""
        sclk = _read(dev / "pp_dpm_sclk") or ""
        state[card.name] = {
            "perf_level": _read(dev / "power_dpm_force_performance_level"),
            "power_profile": next((ln.strip() for ln in profile.splitlines() if "*" in ln), None),
            "sclk": next((ln.strip() for ln in sclk.splitlines() if "*" in ln), None),
        }
    cpu = Path("/sys/devices/system/cpu/cpu0/cpufreq")
    state["cpu_governor"] = _read(cpu / "scaling_governor")
    state["cpu_epp"] = _read(cpu / "energy_performance_preference")
    state["platform_profile"] = _read("/sys/firmware/acpi/platform_profile")
    return state


def gpu_arch_from_kfd() -> str | None:
    """gfx target of the first GPU node, read from KFD topology (works without torch)."""
    for props in sorted(Path("/sys/class/kfd/kfd/topology/nodes").glob("*/properties")):
        for line in (_read(props) or "").splitlines():
            key, _, val = line.partition(" ")
            if key == "gfx_target_version" and val.strip() not in ("", "0"):
                v = int(val)
                return f"gfx{v // 10000}{(v // 100) % 100}{v % 100:x}"
    return None


# --------------------------------------------------------------------------------------------------------------------
# Box agreement
# --------------------------------------------------------------------------------------------------------------------


def box_iou(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)), np.float32)
    lt = np.maximum(a[:, None, :2], b[None, :, :2])
    rb = np.minimum(a[:, None, 2:4], b[None, :, 2:4])
    inter = np.prod(np.clip(rb - lt, 0, None), axis=2)
    area_a = np.prod(a[:, 2:4] - a[:, :2], axis=1)
    area_b = np.prod(b[:, 2:4] - b[:, :2], axis=1)
    return inter / (area_a[:, None] + area_b[None] - inter + 1e-9)


def agreement(ref: dict, pred: dict, iou_thr: float = 0.5) -> dict | None:
    """Match `pred` boxes to `ref` boxes (same class, IoU >= thr, greedy by confidence) over the images both share.

    `ref` is a reference variant's detections or the ground-truth labels. Returns recall (share of ref boxes found),
    precision (share of pred boxes matched), F1 and the mean IoU of matched pairs.
    """
    names = sorted(set(ref) & set(pred))
    if not names:
        return None
    n_ref = n_pred = 0
    ious = []
    for name in names:
        r, p = ref[name], pred[name]
        n_ref, n_pred = n_ref + len(r), n_pred + len(p)
        for c in np.union1d(r[:, 5], p[:, 5]):
            rc, pc = r[r[:, 5] == c], p[p[:, 5] == c]
            pc = pc[np.argsort(-pc[:, 4])]
            iou = box_iou(pc, rc)
            taken = np.zeros(len(rc), bool)
            for i in range(len(pc)):
                if not len(rc):
                    break
                row = np.where(taken, -1.0, iou[i])
                j = int(row.argmax())
                if row[j] >= iou_thr:
                    taken[j] = True
                    ious.append(float(row[j]))
    m = len(ious)
    recall = m / n_ref if n_ref else 1.0
    precision = m / n_pred if n_pred else 1.0
    return {
        "recall": round(recall, 4),
        "precision": round(precision, 4),
        "f1": round(2 * recall * precision / (recall + precision), 4) if recall + precision else 0.0,
        "miou": round(float(np.mean(ious)), 4) if ious else None,
        "n_ref": n_ref,
        "n_pred": n_pred,
        "n_match": m,
        "images": len(names),
    }


# --------------------------------------------------------------------------------------------------------------------
# CLI helpers
# --------------------------------------------------------------------------------------------------------------------


def _selftest() -> int:
    """Compare letterbox and box scaling with Ultralytics' own implementation on awkward shapes."""
    try:
        from ultralytics.data.augment import LetterBox
        from ultralytics.utils.ops import scale_boxes as u_scale
    except ImportError:
        print("ultralytics not importable here; skipping the comparison")
        return 0
    import torch

    rng = np.random.default_rng(0)
    for h, w, s in [(1256, 1256, 800), (261, 303, 800), (480, 640, 640), (1080, 1920, 640), (333, 999, 800)]:
        img = rng.integers(0, 255, (h, w, 3), np.uint8)
        ours = letterbox(img, s)
        theirs = LetterBox((s, s), auto=False, stride=32)(image=img)
        assert ours.shape == theirs.shape and np.array_equal(ours, theirs), f"letterbox mismatch at {h}x{w}->{s}"
        boxes = rng.uniform(0, s, (50, 4)).astype(np.float32)
        boxes[:, 2:] = boxes[:, :2] + rng.uniform(1, 100, (50, 2))
        dets = np.concatenate([boxes, np.ones((50, 2), np.float32)], 1)
        a = scale_boxes(dets, (s, s), (h, w))[:, :4]
        b = u_scale((s, s), torch.from_numpy(boxes.copy()), (h, w)).numpy()
        assert np.allclose(a, b, atol=1e-3), f"scale_boxes mismatch at {h}x{w}->{s}"
    print("selftest OK: letterbox and scale_boxes match Ultralytics")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "runtime":
        print(parse_name(sys.argv[2]).runtime)
    elif len(sys.argv) == 3 and sys.argv[1] == "uses-tuning":
        print(int("tuned" in parse_name(sys.argv[2]).steps))
    elif len(sys.argv) == 2 and sys.argv[1] == "selftest":
        sys.exit(_selftest())
    else:
        sys.exit(__doc__)
