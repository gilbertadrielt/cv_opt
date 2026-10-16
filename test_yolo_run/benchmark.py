"""YOLO26 object detection latency benchmark.

Reads every image in --input_dir, runs batched inference, saves annotated
images (boxes + labels) to a timestamped run folder under --output_dir, and
reports average inference time per batch in milliseconds.

Usage:
    python benchmark.py --model_size nano --batch_size 3
    python benchmark.py --model_size xlarge --batch_size 1 --device cpu
"""

import argparse
import csv
import time
from datetime import datetime
from pathlib import Path

import cv2
import torch
from ultralytics import YOLO

MODEL_SIZE_MAP = {
    "nano": "n",
    "small": "s",
    "medium": "m",
    "large": "l",
    "xlarge": "x",
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args():
    parser = argparse.ArgumentParser(description="YOLO26 inference latency benchmark")
    parser.add_argument("--model_size", choices=MODEL_SIZE_MAP.keys(), default="nano")
    parser.add_argument("--batch_size", type=int, default=1)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument(
        "--device",
        default="auto",
        help="'auto' picks cuda/ROCm if available else cpu. Also accepts 'cpu', 'cuda', 'cuda:0', etc.",
    )
    parser.add_argument("--warmup_batches", type=int, default=1, help="Batches run before timing starts (0 to disable).")
    parser.add_argument("--input_dir", default="input_images")
    parser.add_argument("--output_dir", default="output_images")
    parser.add_argument("--weights_dir", default="weights", help="Where model .pt checkpoints are cached.")
    return parser.parse_args()


def resolve_device(device_arg: str) -> str:
    if device_arg != "auto":
        return device_arg
    return "cuda" if torch.cuda.is_available() else "cpu"


def load_image_paths(input_dir: Path) -> list[Path]:
    if not input_dir.is_dir():
        raise SystemExit(f"Input directory not found: {input_dir}")
    paths = sorted(p for p in input_dir.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not paths:
        raise SystemExit(f"No images found in {input_dir}")
    return paths


def batched(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def run_batch(model: YOLO, batch_paths: list[Path], run_dir: Path, imgsz: int, conf: float, device: str):
    """Runs one batch, saves annotated outputs, and returns (pure_inference_ms, end_to_end_ms)."""
    t0 = time.perf_counter()
    results = model.predict(
        [str(p) for p in batch_paths],
        imgsz=imgsz,
        conf=conf,
        device=device,
        verbose=False,
    )
    for result, src_path in zip(results, batch_paths):
        annotated = result.plot()
        cv2.imwrite(str(run_dir / src_path.name), annotated)
    t1 = time.perf_counter()

    n = len(results)
    # Results.speed['inference'] is ms-per-image, averaged over the batch by ultralytics.
    pure_inference_ms = results[0].speed["inference"] * n if n else 0.0
    end_to_end_ms = (t1 - t0) * 1000
    return pure_inference_ms, end_to_end_ms


def main():
    args = parse_args()
    device = resolve_device(args.device)
    size_suffix = MODEL_SIZE_MAP[args.model_size]
    model_name = f"yolo26{size_suffix}"

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    weights_dir = Path(args.weights_dir)
    weights_dir.mkdir(parents=True, exist_ok=True)

    image_paths = load_image_paths(input_dir)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = output_dir / f"{model_name}_{timestamp}"
    run_dir.mkdir(parents=True, exist_ok=True)

    weights_path = weights_dir / f"{model_name}.pt"
    print(f"Loading {model_name} on device={device} ...")
    # If the checkpoint isn't cached yet, ultralytics downloads it straight to this path.
    model = YOLO(str(weights_path) if weights_path.exists() else model_name)
    if not weights_path.exists():
        downloaded = Path(f"{model_name}.pt")
        if downloaded.exists():
            downloaded.replace(weights_path)
    model.to(device)

    batches = list(batched(image_paths, args.batch_size))
    print(f"{len(image_paths)} images -> {len(batches)} batch(es) of up to {args.batch_size}")

    for i in range(min(args.warmup_batches, len(batches))):
        print(f"warmup batch {i + 1}/{args.warmup_batches}...")
        model.predict([str(p) for p in batches[i]], imgsz=args.imgsz, conf=args.conf, device=device, verbose=False)

    inference_ms_per_batch = []
    e2e_ms_per_batch = []

    for i, batch in enumerate(batches):
        pure_ms, e2e_ms = run_batch(model, batch, run_dir, args.imgsz, args.conf, device)
        inference_ms_per_batch.append(pure_ms)
        e2e_ms_per_batch.append(e2e_ms)
        print(f"batch {i + 1}/{len(batches)} (n={len(batch)}): inference={pure_ms:.2f}ms  end_to_end={e2e_ms:.2f}ms")

    avg_inference = sum(inference_ms_per_batch) / len(inference_ms_per_batch)
    avg_e2e = sum(e2e_ms_per_batch) / len(e2e_ms_per_batch)

    print()
    print(f"Model: {model_name}  Device: {device}  Batch size: {args.batch_size}  Batches: {len(batches)}")
    print(f"Average pure inference time per batch: {avg_inference:.2f} ms")
    print(f"Average end-to-end time per batch:     {avg_e2e:.2f} ms")
    print(f"Annotated images saved to: {run_dir}")

    summary_path = run_dir / "summary.txt"
    with open(summary_path, "w") as f:
        f.write(f"model={model_name}\n")
        f.write(f"device={device}\n")
        f.write(f"batch_size={args.batch_size}\n")
        f.write(f"imgsz={args.imgsz}\n")
        f.write(f"conf={args.conf}\n")
        f.write(f"num_images={len(image_paths)}\n")
        f.write(f"num_batches={len(batches)}\n")
        f.write(f"avg_pure_inference_ms_per_batch={avg_inference:.3f}\n")
        f.write(f"avg_end_to_end_ms_per_batch={avg_e2e:.3f}\n")

    results_csv = output_dir / "benchmark_results.csv"
    is_new = not results_csv.exists()
    with open(results_csv, "a", newline="") as f:
        writer = csv.writer(f)
        if is_new:
            writer.writerow(
                [
                    "timestamp",
                    "model",
                    "device",
                    "batch_size",
                    "imgsz",
                    "num_images",
                    "num_batches",
                    "avg_pure_inference_ms_per_batch",
                    "avg_end_to_end_ms_per_batch",
                    "run_dir",
                ]
            )
        writer.writerow(
            [
                timestamp,
                model_name,
                device,
                args.batch_size,
                args.imgsz,
                len(image_paths),
                len(batches),
                f"{avg_inference:.3f}",
                f"{avg_e2e:.3f}",
                str(run_dir),
            ]
        )


if __name__ == "__main__":
    main()
