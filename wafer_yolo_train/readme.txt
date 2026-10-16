SILICON WAFER YOLO26 TRAINING (Roboflow -> local CUDA GPU)
==========================================================

Fine-tunes a COCO-pretrained YOLO26 checkpoint on Roboflow Universe datasets,
on the local NVIDIA GPU (RTX 4050 Laptop, 6 GB).

    datasets.yaml          which Roboflow datasets to use (workspace/project/version)
    download_datasets.py   fetches them into datasets/<name>/ (auto-run by train.py)
    train.py               trains, then evaluates best.pt on the val and test splits
    .env                   ROBOFLOW_API_KEY=...   (gitignored, never commit it)
    runs/<name>/           training output; weights/best.pt is the checkpoint you want


HOW TO RUN
----------
From this folder, in PowerShell:

    .venv\Scripts\python train.py                       # yolo26s, 800 px, batch 8, 300 epochs (early stop 50)
    .venv\Scripts\python train.py --model yolo26m       # bigger model to compare
    .venv\Scripts\python train.py --epochs 3 --name smoke-test      # 1-minute sanity check
    .venv\Scripts\python download_datasets.py --force   # re-download datasets

Options: --dataset --model --epochs --patience --imgsz --batch --workers --device --name
(--batch -1 auto-sizes to ~60% of VRAM.)

Measured on this laptop: yolo26s @ 800 px, batch 8 = ~3.9 GB VRAM (AMP on).
At 1024 px / batch 8 it fills the whole 6 GB card - lower --batch if you go there.
--workers defaults to 0: on Windows every worker process re-imports torch (~14 s and
several GB of committed memory for 4 train + 8 val workers), and with a 46-image
RAM-cached dataset there is nothing for them to speed up. Use --workers 4 on bigger datasets.

If you see "fatal : Memory allocation failure" + "CUDA error: unknown error": that is a
HOST-side allocation failure inside CUDA's runtime compiler, not VRAM. Close Chrome/Teams/
etc. (this machine runs near its RAM + commit limit), keep >10 GB free on C:, retry.


MODEL CHOICE
------------
YOLO26 (n/s/m/l/x = 2.4 / 9.5 / 20.4 / 24.8 / 55.7 M params). Used here because:
  - STAL (small-target-aware label assignment) targets small objects; bond pads
    are 15-75 px in the 1256 px images.
  - End-to-end / NMS-free head: no NMS threshold to tune at inference.
  - Same ultralytics API, so checkpoints already in ../test_yolo_run/weights are reused.
Start with yolo26s; compare against yolo26m. l/x will not fit comfortably on 6 GB.


ADDING THE SECOND DATASET
-------------------------
Uncomment/fill the template at the bottom of datasets.yaml (workspace, project,
version from its Universe URL), then:

    .venv\Scripts\python train.py --dataset <key>

Two datasets with different classes should be trained as separate runs. Training one
model on both needs a merged dataset with a unified class list (not set up here).


ENVIRONMENT NOTES (how this venv was built)
-------------------------------------------
C: had only ~4.7 GB free, too little for a fresh CUDA torch (2.6 GB wheel + unpack).
So .venv was created from the conda env "miniconda3\envs\venv" with
--system-site-packages, reusing its torch 2.2.2 + CUDA 12.1. Ultralytics and the
pins in requirements.txt live inside .venv only; the conda env is untouched.

Your network re-signs HTTPS, so Python needs the Windows cert store: that is what
`truststore` is for (download_datasets.py injects it). Old pip (24.0) in that venv
cannot reach PyPI; install packages with the newer base pip instead:

    C:\Users\gilbe\miniconda3\python.exe -m pip --python .venv\Scripts\python.exe install <pkg>

If you free disk space and want current torch, make a fresh venv and drop the numpy /
opencv pins in requirements.txt.


DATA NOTES (Roboflow "Silicon Wafer", v9)
-----------------------------------------
- 69 images: 46 train / 20 val / 3 test. The 3-image test split is too small to mean
  anything; judge on val, and treat results as indicative.
- Classes: Die, Pad 1, Pad 2, Pad 3. Die is rare: v9 has 66 Die boxes vs 324-688 per pad
  class (train 49 / val 15 / test 2 Die). Roboflow's project page shows 96/465/820/431,
  but that counts every image in the project, not just v9.
- v9 has no baked-in augmentation; Ultralytics augments on the fly (mosaic, flip, HSV).
- Label oddities worth a look in Roboflow: valid/seg_die_-0-2-_subdie_4_pullouts_1 has
  a "Pad 3" box of 786x927 px (die-sized, likely a mislabeled Die), and
  train/seg_die_-0-6-_subdie_4_pullouts_1 labels 18 tiny ~85 px squares as "Die"
  while every other Die box is ~700 px.
