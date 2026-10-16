"""Fine-tune a YOLO26 checkpoint on a Roboflow dataset using the local CUDA GPU.

    python train.py                                       # yolo26s on the first dataset in datasets.yaml
    python train.py --model yolo26m --imgsz 1024 --batch 4
    python train.py --dataset silicon-wafer --epochs 3 --name smoke-test

The dataset is downloaded automatically on first use (see download_datasets.py).
Results land in runs/<name>/ ; the checkpoint you want is runs/<name>/weights/best.pt.
"""
import argparse
import sys
from pathlib import Path

import torch
import yaml
from ultralytics import YOLO

from download_datasets import ROOT, ensure_dataset, load_config

LOCAL_WEIGHTS = ROOT / "weights"
SIBLING_WEIGHTS = ROOT.parent / "test_yolo_run" / "weights"  # checkpoints already downloaded there


def resolve_weights(model: str) -> str:
    """Use a checkpoint that is already on disk; otherwise Ultralytics downloads it into ./weights."""
    name = model if model.endswith(".pt") else f"{model}.pt"
    for folder in (LOCAL_WEIGHTS, SIBLING_WEIGHTS):
        if (folder / name).is_file():
            return str(folder / name)
    LOCAL_WEIGHTS.mkdir(exist_ok=True)
    return str(LOCAL_WEIGHTS / name)


def print_metrics(split: str, m, names: dict) -> None:
    print(f"\n[{split}] mAP50-95 {m.box.map:.3f} | mAP50 {m.box.map50:.3f} | P {m.box.mp:.3f} | R {m.box.mr:.3f}")
    for c in m.box.ap_class_index:
        print(f"    {names[int(c)]:<10} mAP50-95 {m.box.maps[int(c)]:.3f}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", default=next(iter(load_config())), help="key in datasets.yaml")
    ap.add_argument("--model", default="yolo26s", help="yolo26n | yolo26s | yolo26m | yolo26l | yolo26x, or a .pt path")
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--patience", type=int, default=50, help="stop if val fitness hasn't improved for N epochs")
    ap.add_argument("--imgsz", type=int, default=800, help="pads are ~15-75 px in the 1256 px images; 1024 + batch 8 fills the 6 GB card")
    ap.add_argument("--batch", type=int, default=8, help="-1 = auto-size to ~60%% of VRAM")
    ap.add_argument("--workers", type=int, default=0,
                    help="dataloader workers; 0 is faster on Windows for tiny datasets (each worker re-imports torch)")
    ap.add_argument("--device", default="0")
    ap.add_argument("--name", default=None, help="run name (default: <dataset>_<model>)")
    args = ap.parse_args()

    if not torch.cuda.is_available():
        sys.exit(
            "CUDA is not available to PyTorch (this would train on CPU for hours).\n"
            f"torch {torch.__version__} - install the CUDA build into the venv:\n"
            "  .venv\\Scripts\\pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126"
        )

    data_yaml = ensure_dataset(args.dataset)
    model = YOLO(resolve_weights(args.model))
    run_name = args.name or f"{args.dataset}_{args.model}"

    model.train(
        data=str(data_yaml),
        epochs=args.epochs,
        patience=args.patience,
        imgsz=args.imgsz,
        batch=args.batch,
        workers=args.workers,
        device=args.device,
        project=str(ROOT / "runs"),
        name=run_name,
        cache="ram",  # the whole dataset is a few MB; skip disk reads
    )

    best = YOLO(str(model.trainer.best))
    splits = yaml.safe_load(data_yaml.read_text(encoding="utf-8"))
    for split in ("val", "test"):
        if split not in splits:
            continue
        m = best.val(data=str(data_yaml), split=split, imgsz=args.imgsz, batch=4,
                     device=args.device, plots=False)
        print_metrics(split, m, best.names)
    print(f"\nBest weights: {model.trainer.best}")


if __name__ == "__main__":  # required on Windows: dataloader workers re-import this module
    main()
