"""Export static-shape ONNX models for the MIGraphX variants: one per batch size and precision, NMS-free head.

    python export_onnx.py --model best.pt --batch 1 8 --imgsz 800 --out artifacts

Writes <out>/<stem>_b<B>_<imgsz>_fp32.onnx, which the raw MIGraphX runner quantizes itself, and _fp16.onnx, exported
in FP16 on the GPU as Ultralytics' AMD guide recommends, for the MIGraphX EP. The ONNX export is the hand-off point:
everything after it can run in a venv without PyTorch.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", default="best.pt")
    p.add_argument("--batch", type=int, nargs="+", default=[1, 8])
    p.add_argument("--imgsz", type=int, default=800)
    p.add_argument("--precision", nargs="+", default=["fp32", "fp16"], choices=["fp32", "fp16"])
    p.add_argument("--device", default="0", help="FP16 export needs the GPU")
    p.add_argument("--opset", type=int, default=None, help="default: Ultralytics' choice; try 17 if MIGraphX rejects an op")
    p.add_argument("--out", default="artifacts")
    p.add_argument("--force", action="store_true", help="re-export even if the file exists")
    args = p.parse_args()

    os.environ["YOLO_AUTOINSTALL"] = "False"
    import onnx
    from ultralytics import YOLO

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = Path(args.model).stem
    failed = 0
    for batch in args.batch:
        for prec in args.precision:
            dst = out / f"{stem}_b{batch}_{args.imgsz}_{prec}.onnx"
            if dst.exists() and not args.force:
                print(f"exists, skipping: {dst}")
                continue
            try:
                f = YOLO(args.model).export(
                    format="onnx",
                    imgsz=args.imgsz,
                    batch=batch,
                    dynamic=False,
                    simplify=True,
                    nms=False,  # one-to-one head: output (B, 300, 6), no NMS anywhere
                    quantize=16 if prec == "fp16" else None,
                    device=args.device,
                    opset=args.opset,
                )
                shutil.move(f, dst)
            except Exception as e:
                print(f"FAILED {dst.name}: {type(e).__name__}: {e}")
                failed += 1
                continue
            g = onnx.load(str(dst)).graph
            dims = lambda v: [d.dim_value or d.dim_param for d in v.type.tensor_type.shape.dim]  # noqa: E731
            print(f"wrote {dst}: input {dims(g.input[0])} -> output {dims(g.output[0])}")
            if dims(g.output[0])[-1] != 6:
                print("  WARNING: output is not (B, 300, 6); the model did not export its NMS-free head")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
