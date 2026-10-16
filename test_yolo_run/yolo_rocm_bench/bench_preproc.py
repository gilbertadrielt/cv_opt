"""Time the ways a batch of decoded frames can become the network's input tensor on the GPU.

    python bench_preproc.py --images data/test_images --batch 1 --imgsz 800

cpu         cv2 letterbox per frame, pageable copy, reorder and scale on the GPU (what Ultralytics does)
cpu_pinned  the same, staged through a reused pinned host buffer with a non-blocking copy
gpu         raw frames copied (pinned) to the GPU, then resized and padded there with torch ops

Each path ends with a synchronised (B, 3, imgsz, imgsz) FP16 tensor. The GPU path needs one resolution per batch, so
all paths run on one resolution: --resolution WxH resizes every image to the line camera's size (letterbox cost
depends on size, not content), else the most common resolution in the folder is used. Decides whether a GPU
letterbox is worth building.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

import common as C


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--images", default="data/test_images")
    p.add_argument("--batch", type=int, default=1)
    p.add_argument("--imgsz", type=int, default=800)
    p.add_argument("--iters", type=int, default=100)
    p.add_argument("--warmup", type=int, default=10)
    p.add_argument("--device", default="cuda")
    p.add_argument("--resolution", default="", help="WxH of the line camera, e.g. 1256x1256; resizes every image to it")
    p.add_argument("--out", default="results")
    args = p.parse_args()

    import cv2
    import torch
    import torch.nn.functional as F

    paths = C.list_images(args.images)
    frames = C.read_images(paths)
    if args.resolution:
        w, h = (int(v) for v in args.resolution.lower().split("x"))
        frames = [cv2.resize(f, (w, h), interpolation=cv2.INTER_LINEAR) for f in frames]
    res, share = Counter(f.shape for f in frames).most_common(1)[0]
    if share * 2 < len(frames):
        print(
            f"WARNING: only {share} of {len(frames)} images share one resolution ({res[1]}x{res[0]}), so this times "
            f"{share} frame(s). Pass --resolution WxH (the line camera's size) to time all of them."
        )
    frames = [f for f in frames if f.shape == res]
    H, W, S, B = res[0], res[1], args.imgsz, args.batch
    dev = torch.device(args.device)
    batches = C.timing_batches(len(frames), B, args.warmup + args.iters)
    (new_w, new_h), (top, bottom, left, right) = C.letterbox_params((H, W), S)

    def finish(u8_bhwc):  # Ultralytics' on-device tail: BHWC uint8 -> BCHW RGB fp16 in 0..1
        return u8_bhwc.permute(0, 3, 1, 2).flip(1).contiguous().half().div_(255)

    def cpu(idx):
        lb = np.stack([C.letterbox(frames[i], S) for i in idx])
        return finish(torch.from_numpy(lb).to(dev))

    pinned_lb = torch.empty((B, S, S, 3), dtype=torch.uint8).pin_memory()
    pinned_lb_np = pinned_lb.numpy()

    def cpu_pinned(idx):
        for j, i in enumerate(idx):
            pinned_lb_np[j] = C.letterbox(frames[i], S)
        return finish(pinned_lb.to(dev, non_blocking=True))

    pinned_raw = torch.empty((B, H, W, 3), dtype=torch.uint8).pin_memory()
    pinned_raw_np = pinned_raw.numpy()

    def gpu(idx):
        for j, i in enumerate(idx):
            pinned_raw_np[j] = frames[i]
        x = pinned_raw.to(dev, non_blocking=True).permute(0, 3, 1, 2).flip(1).float()
        if (new_w, new_h) != (W, H):
            x = F.interpolate(x, size=(new_h, new_w), mode="bilinear", align_corners=False)
        x = F.pad(x, (left, right, top, bottom), value=float(C.PAD_VALUE))
        return x.round_().half().div_(255)

    result = {"resolution": [H, W], "frames": len(frames), "of_total": len(paths), "batch": B, "imgsz": S, "paths": {},
              "resized_to_camera": bool(args.resolution)}
    for name, fn in (("cpu", cpu), ("cpu_pinned", cpu_pinned), ("gpu", gpu)):
        times = []
        for k, idx in enumerate(batches):
            torch.cuda.synchronize()
            t = time.perf_counter()
            fn(idx)
            torch.cuda.synchronize()
            if k >= args.warmup:
                times.append((time.perf_counter() - t) * 1e3)
        result["paths"][name] = C.summarize_ms(times)
        print(f"{name:<11} p50 {result['paths'][name]['p50']:.3f} ms  p95 {result['paths'][name]['p95']:.3f} ms per batch")

    ref, g = cpu(batches[0]).float(), gpu(batches[0]).float()
    result["gpu_vs_cpu_max_abs_diff"] = round(float((ref - g).abs().max()), 4)  # in 0..1 units; bilinear vs cv2 rounding
    print(f"gpu letterbox vs cv2: max abs diff {result['gpu_vs_cpu_max_abs_diff']} (0..1 scale)")
    if len(frames) < len(paths):
        print(f"note: timed the {len(frames)}/{len(paths)} frames at {W}x{H}; other resolutions were left out")
    C.write_json(Path(args.out) / "preproc" / f"preproc_b{B}.json", result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
