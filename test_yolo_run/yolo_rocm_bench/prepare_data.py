"""Lay out a YOLO dataset as the harness expects: test images + labels, and a separate INT8 calibration set.

    python yolo_rocm_bench/prepare_data.py              # bundled yolo_rocm_bench/datasets/silicon-wafer -> data/
    python yolo_rocm_bench/prepare_data.py --src <other YOLO dataset> --out data

Test set = the --eval-splits (default valid + test), calibration = the --calib-splits (default train), so the INT8
calibration images never overlap the images it is judged on. Prints counts and resolutions, which matter here:
latency does not depend on image content, but accuracy verdicts from a few dozen images are low-confidence.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from collections import Counter
from pathlib import Path

import cv2

import common as C


def copy_split(src: Path, splits: list[str], images_out: Path, labels_out: Path | None) -> list[Path]:
    images_out.mkdir(parents=True, exist_ok=True)
    if labels_out:
        labels_out.mkdir(parents=True, exist_ok=True)
    copied = []
    for split in splits:
        img_dir = src / split / "images"
        if not img_dir.is_dir():
            print(f"  no {img_dir}, skipping")
            continue
        for p in C.list_images(img_dir):
            dst = images_out / p.name
            shutil.copy2(p, dst)
            copied.append(dst)
            lab = src / split / "labels" / f"{p.stem}.txt"
            if labels_out and lab.exists():
                shutil.copy2(lab, labels_out / lab.name)
    return copied


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--src",
        default=str(Path(__file__).resolve().parent / "datasets" / "silicon-wafer"),
        help="dataset root holding <split>/images and <split>/labels (default: the copy bundled next to this script)",
    )
    p.add_argument("--out", default="data")
    p.add_argument("--eval-splits", nargs="+", default=["valid", "test"])
    p.add_argument("--calib-splits", nargs="+", default=["train"])
    args = p.parse_args()

    src, out = Path(args.src), Path(args.out)
    for d in ("test_images", "test_labels", "calib_images"):
        shutil.rmtree(out / d, ignore_errors=True)
    test = copy_split(src, args.eval_splits, out / "test_images", out / "test_labels")
    calib = copy_split(src, args.calib_splits, out / "calib_images", None)
    n_labels = len(list((out / "test_labels").glob("*.txt")))

    sizes = Counter()
    for f in test:
        im = cv2.imread(str(f))
        sizes[f"{im.shape[1]}x{im.shape[0]}"] += 1
    print(f"test images:  {len(test)} ({n_labels} with labels) -> {out / 'test_images'}")
    print(f"calibration:  {len(calib)} -> {out / 'calib_images'}")
    print(f"resolutions:  {dict(sizes.most_common())}")
    if len(test) < 100:
        print(f"note: {len(test)} test images; timing cycles through them fine, but treat accuracy verdicts as rough")
    if len(calib) < 64:
        print(f"note: {len(calib)} calibration images; INT8 results will be a weak signal (runbook suggests 64-256)")
    if len(sizes) > 1:
        print("note: mixed resolutions; set CAMERA=WxH (the line camera size) so bench_preproc.py times every image, not the most common size only")
    return 0 if test else 1


if __name__ == "__main__":
    sys.exit(main())
