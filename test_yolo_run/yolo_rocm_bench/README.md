# YOLO26 latency harness for ROCm (EVO-X2, Radeon 8060S, gfx1151)

This folder measures how much each latency method cuts YOLO26 inference time on the Strix Halo iGPU, and what each
one costs in detection accuracy. It runs a ladder of variants, where each rung adds exactly one change to the one
before it, and then a set of ROCm-level settings ("knobs") on top of chosen rungs. The output is one report,
`results/report.md`, with speed, accuracy and a suggested pick per batch size.

Everything below runs on the **EVO-X2 (Ubuntu, ROCm 10.1)**, except step 1, which you can do on the Windows laptop.

## What has and has not been tested

The harness was exercised on the Windows laptop (RTX 4050, CUDA). PyTorch's ROCm build uses the same `torch.cuda`
API, so most of the code runs unchanged on both vendors. On the laptop, these were tested end to end: the PyTorch
rungs, HIP-graph capture (`torch.cuda.CUDAGraph`), the timing, warm-up and accuracy logic, ONNX export, the report
and `run_all.sh`. The raw MIGraphX runner's letterbox, decode and rescale pipeline, run through ONNX Runtime CPU in
place of MIGraphX, reproduced Ultralytics' boxes exactly (555/555 matched).

**Not tested anywhere yet:** the MIGraphX API calls, the ONNX Runtime MIGraphX plugin, `torch.compile` on gfx1151,
the ROCm env-var knobs (they are ignored on CUDA), `gpu_perf.sh` and the ROCm profiler output. Expect the MIGraphX
rungs or `compile` to possibly need a fix on first contact. Every run is its own process with its own log, so one
failure never stops the rest: send the failing log from `results/logs/` and it can be fixed quickly.

## Quick path

| Step | Where | What |
|---|---|---|
| [1](#1-prepare-the-data-and-copy-it-over) | Laptop | Build the test, label and calibration folders; copy everything to the EVO-X2 |
| [2](#2-install-the-stack-once) | EVO-X2 | One-time setup: groups, Python 3.12 venv, ROCm 10.1 packages |
| [3](#3-check-the-stack) | EVO-X2 | Check the stack |
| [4](#4-quiet-the-machine-and-fix-the-power-state) | EVO-X2 | Quiet the machine, fix the power state |
| [5](#5-smoke-test) | EVO-X2 | Smoke test, including MIGraphX |
| [6](#6-full-run) | EVO-X2 | Full run |
| [7](#7-second-run-noise-check) | EVO-X2 | Second run, to check the numbers are stable |
| [8](#8-real-line-conditions) | EVO-X2 | Real-line conditions: image gaps, clocks, LLM running |
| [9](#9-read-the-report-and-decide) | Either | Read the report and pick a variant |

## 1. Prepare the data and copy it over

The wafer dataset is bundled in this folder at `datasets/silicon-wafer` (Roboflow `silicon-wafer` v9, YOLO format,
25 MB): 69 labelled images, split 46 train / 20 valid / 3 test. The harness needs three flat folders: test images,
their YOLO labels, and separate INT8 calibration images. `prepare_data.py` builds them from the bundled dataset: test
images come from `valid` + `test` (23 images, 536 labelled boxes, 8 resolutions), and calibration images from
`train` (46), so the two never overlap. It runs wherever the folder is, so you can also run it on the laptop to preview.

Treat the accuracy columns as rough: 23 images is small, and `valid` was also what training used to pick `best.pt`,
so absolute scores on it are optimistic. The harness compares variants on the same images, so the differences
between rows are what to trust. Timing is not affected, because it cycles through the images. INT8 calibration on 46
images is a weak signal. More labelled line images make every accuracy number stronger: add them to the dataset, or
point `--src` at another YOLO-format dataset.

Pick the checkpoint you will deploy, and note the image size it was trained at (`imgsz` in the run's
`args.yaml`). The wafer runs use **800**. Benchmark at that size, not 640.

Copy the harness (with its dataset), the triage script and the checkpoint to the EVO-X2 (here `~/yolo_bench`), from
`test_yolo_run` in PowerShell:

```powershell
ssh <user>@<evo-x2> "mkdir -p ~/yolo_bench"
scp -r yolo_rocm_bench rocm_triage.py `
    ..\wafer_yolo_train\runs\silicon-wafer_yolo26m\weights\best.pt <user>@<evo-x2>:~/yolo_bench/
```

Then, on the EVO-X2, build the three folders (the Python environment from step 2 is needed, so come back to this
command after it, or run it on the laptop before copying and add `data` to the `scp`):

```bash
cd ~/yolo_bench
python yolo_rocm_bench/prepare_data.py          # -> data/test_images, data/test_labels, data/calib_images
```

On the EVO-X2, every command below is run from `~/yolo_bench`, which then holds:

```text
~/yolo_bench/
  yolo_rocm_bench/   this folder, with datasets/silicon-wafer inside
  rocm_triage.py     layer-by-layer ROCm check (from test_yolo_run/)
  best.pt            the checkpoint under test
  data/              test_images/, test_labels/, calib_images/ (made by prepare_data.py)
```

## 2. Install the stack (once)

**Groups.** Your user must own the GPU device nodes. Run this once, then log out and back in (not just a new
terminal):

```bash
sudo usermod -aG render,video $USER
```

**Kernel.** ROCm 10.1 supports Ubuntu 24.04.5 with the HWE 7.0 kernel, or Ubuntu 26.04.1 with its GA 7.0 kernel.
Check with `uname -r`. Newer amdgpu drivers have measurably improved gfx1151 performance, so do not run an old kernel.

**Python 3.12.** The MIGraphX wheels are built for Python 3.12 only. On Ubuntu 24.04, `python3` is 3.12. On 26.04,
install 3.12 first (for example `uv python install 3.12`, then `uv venv --python 3.12`).

**Packages.** One venv holds PyTorch, MIGraphX and the ONNX Runtime plugin. They share the same ROCm 10.1 runtime
(`torch[device-gfx1151]` already pulls in the gfx1151 libraries MIGraphX needs). Run the steps in this order:

```bash
python3.12 -m venv ~/venvs/yolo-rocm
source ~/venvs/yolo-rocm/bin/activate
python -m pip install -U pip

# a) PyTorch for gfx1151 on ROCm 10.1 (AMD's index; pulls in Triton 3.8 for torch.compile)
python -m pip install --index-url https://stable.repo.amd.com/rocm/whl-next/ \
    "torch[device-gfx1151]==2.14.0+rocm10.1.0" "torchvision[device-gfx1151]==0.29.0a0+rocm10.1.0"

# b) ONNX Runtime from PyPI, then MIGraphX and its ONNX Runtime plugin from AMD
python -m pip install "onnxruntime~=1.29.0"
python -m pip install --index-url https://stable.repo.amd.com/rocm/migraphx/whl-next/ \
    --extra-index-url https://stable.repo.amd.com/rocm/onnxruntime/whl-next/ \
    --extra-index-url https://stable.repo.amd.com/rocm/whl-next/ \
    "migraphx[device-gfx1151]==2.18.0+rocm10.1.0" "onnxruntime-ep-migraphx[device-gfx1151]==1.0.0+rocm10.1.0"

# c) Ultralytics and the ONNX tools from PyPI (requirements.txt); the constraints file stops pip swapping the AMD builds above
python -m pip install -c yolo_rocm_bench/constraints-rocm.txt -r yolo_rocm_bench/requirements.txt

# d) verify before going on: no nvidia-* packages, only +rocm builds, no 0.0.x placeholders
python -m pip list 2>/dev/null | grep -i -E "nvidia|torch|rocm|migraphx|onnxruntime"
```

If you already have a constraints file from a setup that worked, use it instead of `constraints-rocm.txt`:
install `torch` and `torchvision` first (a), then
`python -m pip install -c <your constraints file> -r yolo_rocm_bench/requirements.txt`. `requirements.txt` lists only
PyPI packages, unpinned, so it cannot conflict with your file; the AMD-built packages (torch, torchvision, migraphx,
migraphx-libs, onnxruntime-ep-migraphx) must be pinned there, with the same `+rocm` suffix.

Notes:

- **Never install `migraphx` or `onnxruntime-ep-migraphx` without an exact `==...+rocm...` pin.** PyPI hosts empty
  placeholder packages with those names (`migraphx 0.0.1`, `onnxruntime-ep-migraphx 0.0.0`). A bare install, or one
  where the AMD index is mistyped or unreachable, silently installs the placeholder and `import migraphx` then fails or
  has no `parse_onnx`. The AMD MIGraphX and ONNX Runtime indexes serve only their own packages, so use them
  with exact pins and never as the only index for anything else.
- The `[device-gfx1151]` extras matter. Without them, a MIGraphX install in a venv without torch has no GPU runtime.
- `ultralytics==8.4.176` is the version this harness was checked against. Newer releases should work; `env_check.py`
  tells you if one drops an argument the harness needs.
- **Never let Ultralytics auto-install packages on this machine.** Ultralytics 8.4.176 pins its MIGraphX plugin to
  the ROCm 10.0 builds and, on the first ONNX run, would pip-install `migraphx-libs 2.17` over your 10.1 stack. The
  harness sets `YOLO_AUTOINSTALL=False` itself. Set it yourself (`export YOLO_AUTOINSTALL=False`) whenever you run
  Ultralytics outside the harness, including in the production ML service.
- `../requirements-rocm.txt` and `../readme.txt` describe the older ROCm 10.0 setup. Follow this file instead, and do
  **not** set `HSA_OVERRIDE_GFX_VERSION` (the gfx1151 wheels are native).

## 3. Check the stack

```bash
python yolo_rocm_bench/env_check.py --out results
python rocm_triage.py
```

`env_check.py` must end with `OK: environment ready`. Each line is PASS, WARN or FAIL:

- **FAIL** blocks everything: not a ROCm torch build, GPU not visible, no `/dev/kfd` access, or Ultralytics too old.
  See [Troubleshooting](#troubleshooting).
- **WARN** only affects the rung it names. For example, if `torch.compile smoke test` warns, the `compile` rungs will
  fail. If `MIGraphX EP` warns, `migraphx_ep` will fail.

`rocm_triage.py` tests each layer separately (allocator, copies, MIOpen fp32/fp16 convolution, hipBLASLt,
torchvision NMS, a full YOLO26 predict). If one stage fails, it names the broken library.

## 4. Quiet the machine and fix the power state

Every number depends on nothing else using the iGPU and on a fixed power state.

1. Stop the RCA LLM and anything else on the GPU. Check with `rocm-smi --showuse` or `amd-smi monitor`.
2. Pick one power state and keep it for every run you compare. `gpu_perf.sh` shows and sets the GPU performance
   level, power profile, CPU governor (letterbox and post-processing run on the CPU) and platform profile:

   ```bash
   bash yolo_rocm_bench/gpu_perf.sh status          # what it is now
   sudo bash yolo_rocm_bench/gpu_perf.sh high       # recommended for the main runs: clocks held high
   sudo bash yolo_rocm_bench/gpu_perf.sh auto       # restore when you are done
   ```

   Also set the EVO-X2's BIOS/OS performance mode to the one you will deploy with, and leave it there. Every result
   records the power state, and the report warns if rows were measured under different states.

The first full run takes a long time (MIOpen tuning, `torch.compile` and MIGraphX compiles all build caches), so run
it inside `tmux` or `screen` in case your SSH session drops.

## 5. Smoke test

Run a few seconds of the simplest rung, then the MIGraphX path, which is the least-tested part:

```bash
S="--model best.pt --images data/test_images --batch 1 --imgsz 800 --iters 5 --warmup 2 --limit 8 --out results_smoke"
python yolo_rocm_bench/bench_ultralytics.py --variant baseline $S

python yolo_rocm_bench/export_onnx.py --model best.pt --batch 1 --imgsz 800 --out artifacts
python yolo_rocm_bench/bench_ultralytics.py --variant migraphx_ep $S
python yolo_rocm_bench/bench_migraphx.py --variant mgx_fp16 $S
```

Each command should end with a `p50 ... ms  p95 ... ms` line. The first MIGraphX runs compile for a few minutes;
later runs load the compiled program from cache. If one prints `failed`, the line says why. The full traceback is
above it, and the same reason is in `results_smoke/runs/<name>_b1.json`.

## 6. Full run

```bash
MODEL=best.pt IMAGES=data/test_images LABELS=data/test_labels CALIB=data/calib_images IMGSZ=800 \
TARGET_P95=<p95 ms per batch the line needs> \
    bash yolo_rocm_bench/run_all.sh 2>&1 | tee run1.log
```

`run_all.sh` runs, in order:

1. Environment check.
2. `baseline`, `fp16`, `static`, each starting from an empty MIOpen database, so they are reproducible.
3. The MIOpen tuning pass.
4. `tuned`, `nmsfree`, `hipgraph`, `compile`, `compile_graphs`.
5. The pre-processing micro-benchmark.
6. ONNX export.
7. `migraphx_ep`, `mgx_fp16`, `mgx_int8`.
8. The ROCm knobs.
9. The report.

All of this runs at batch 1 and batch 8. It keeps going past failures and lists them at the end. Each step's
output is in `results/logs/<step>.log`.

Leave `TARGET_P95` out (or `0`) if you don't know the line's requirement yet. The report then shows the fastest
variant that passes the accuracy bar, without the "simplest variant meeting the target" line.

### Settings

Set any of these in front of the command, as above.

| Setting | Default | Meaning |
|---|---|---|
| `MODEL` | `best.pt` | Checkpoint under test |
| `IMAGES` / `LABELS` / `CALIB` | `data/test_images` / none / none | Test images, their YOLO labels, INT8 calibration images |
| `IMGSZ` | `800` | Input size; use the training size |
| `BATCHES` | `"1 8"` | Batch sizes; use the one you will deploy (1 if images arrive one at a time) |
| `ITERS` / `WARMUP` | `100` / `10` | Timed batches, and extra untimed batches after a warm-up pass over every image. Use `ITERS=500` before quoting p99 |
| `ONLY` | all | Subset of rungs and knobs, e.g. `"fp16 migraphx_ep tuned+nhwc"`; add `preproc` to include the micro-benchmark |
| `KNOBS` | see [Knobs](#knobs) | Knob runs, space-separated; `KNOBS=""` skips them |
| `SKIP_TUNE` | `0` | `1` reuses the existing MIOpen perf DB instead of tuning |
| `TUNE_LEVEL` | `3` | `3` incremental tuning, `4` exhaustive (much slower, sometimes faster kernels) |
| `CAMERA` | none | Line camera resolution `WxH` (e.g. `1256x1256`): the pre-processing benchmark resizes images to it, so mixed-size test images are all timed |
| `PROFILE` | `20` | Batches profiled per rung with torch.profiler (`0` = off) |
| `GAP_MS` | `0` | Idle time between timed batches, to mimic the line's image cadence; tags rows `@gap<N>` |
| `TAG` | none | Free label for a run, e.g. `contended`; tags rows `@<TAG>` |
| `TARGET_P95` | `0` | p95 per batch the line needs, for the decision lines |
| `PY_TORCH` / `PY_MIGX` | `python` / same | Interpreters, if MIGraphX ever has to live in its own venv |
| `OUT` / `ART` / `CACHE` | `results` / `artifacts` / `.cache` | Results; ONNX and compiled engines; MIOpen, TunableOp and MIGraphX caches |

### The ladder

| Rung | Adds one change | Compared with |
|---|---|---|
| `baseline` | FP32, Ultralytics defaults (`rect=True`, NMS on), untuned MIOpen | – |
| `fp16` | `quantize=16` | `baseline` |
| `static` | Fixed `imgsz × imgsz` input (`rect=False`) | `fp16` |
| `tuned` | MIOpen Find (`cudnn.benchmark`) + tuned perf DB | `static` |
| `nmsfree` | One-to-one NMS-free head (`nms=False`) | `tuned` |
| `hipgraph` | The network forward replayed as a HIP graph (no compiler involved) | `nmsfree` |
| `compile` | `torch.compile`, Inductor `default` mode | `nmsfree` |
| `compile_graphs` | `torch.compile` `reduce-overhead` (Inductor + HIP graphs) | `compile` |
| `migraphx_ep` | Same model as `nmsfree`, FP16 ONNX on the MIGraphX EP through Ultralytics (zero-copy GPU I/O) | `nmsfree` |
| `mgx_fp16` | Raw MIGraphX API, FP32 ONNX quantized to FP16 by MIGraphX | `nmsfree` |
| `mgx_int8` | Raw MIGraphX API, INT8 calibrated on `CALIB` | `mgx_fp16` |

### Knobs

A knob run is named `<rung>+<knob>` and is compared with the same rung without it. The default `KNOBS` list is
`tuned+hipblaslt tuned+tunableop tuned+nhwc nmsfree+nosdma compile+autotune migraphx_ep+exhaustive
migraphx_ep+winograd migraphx_ep+mlirtune mgx_fp16+exhaustive`.

| Knob | Applies to | What it sets |
|---|---|---|
| `hipblaslt` | PyTorch rungs | GEMMs on hipBLASLt (`TORCH_BLAS_PREFER_HIPBLASLT=1`, `ROCBLAS_USE_HIPBLASLT=1`) |
| `tunableop` | PyTorch rungs | PyTorch TunableOp tunes GEMMs during warm-up; results kept in `.cache/tunableop/` |
| `nhwc` | PyTorch rungs | `channels_last` + MIOpen NHWC kernels (`PYTORCH_MIOPEN_SUGGEST_NHWC=1`); tuned separately |
| `autotune` | `compile` rungs | `torch.compile` mode `max-autotune-no-cudagraphs` |
| `hiprio` | PyTorch rungs | Inference on a high-priority HIP stream; only meaningful with the LLM running |
| `nosdma` | all | `HSA_ENABLE_SDMA=0`: host↔GPU copies by blit kernels instead of the DMA engines |
| `exhaustive` | MIGraphX rungs | Exhaustive kernel tuning at compile time |
| `mlirtune` | MIGraphX rungs | Exhaustive rocMLIR tuning (`MIGRAPHX_MLIR_TUNE_EXHAUSTIVE=1`) |
| `winograd` | MIGraphX rungs | Winograd convolutions on. Ultralytics turns them off to save compile time, which a cached engine pays once |

Knobs stack (`tuned+nhwc+hipblaslt` is compared with `tuned+nhwc`). Any run name works with `ONLY`.

## 7. Second run (noise check)

Repeat the run into a second folder, with the same power state and the existing tuning, then compare:

```bash
MODEL=best.pt IMAGES=data/test_images LABELS=data/test_labels CALIB=data/calib_images IMGSZ=800 \
SKIP_TUNE=1 OUT=results_run2 bash yolo_rocm_bench/run_all.sh 2>&1 | tee run2.log
python yolo_rocm_bench/report.py --out results --compare results_run2
```

`results_run2/compare.md` flags every run whose p50 moved more than 5%. If several did, the machine was not quiet or
the power state changed. Fix that before trusting differences of a few percent.

## 8. Real-line conditions

The main run sends batches back to back on a quiet, warm GPU, which is the best case. These runs add what the line
really does. They write into the same `results/` folder: tagged rows are compared rung to rung under the same tag, and
a one-off tagged run is compared with its untagged self.

**Image cadence.** On the line, images arrive with gaps, and an idle iGPU drops its clocks. On the laptop's GPU, a
200 ms gap doubled p50. Set `GAP_MS` to the real time between images (or batches):

```bash
GAP_MS=200 SKIP_TUNE=1 KNOBS="" ONLY="baseline fp16 static tuned nmsfree hipgraph migraphx_ep" \
MODEL=best.pt IMAGES=data/test_images LABELS=data/test_labels IMGSZ=800 bash yolo_rocm_bench/run_all.sh
```

**Clocks held high vs driver default.** Run the cadence command above with the GPU on `auto`
(`sudo bash yolo_rocm_bench/gpu_perf.sh auto`). Then switch to `high` and re-run just your chosen rung with a tag:

```bash
sudo bash yolo_rocm_bench/gpu_perf.sh high
GAP_MS=200 TAG=clockhigh SKIP_TUNE=1 KNOBS="" ONLY="nmsfree" \
MODEL=best.pt IMAGES=data/test_images LABELS=data/test_labels IMGSZ=800 bash yolo_rocm_bench/run_all.sh
```

`nmsfree@gap200@clockhigh` is compared with `nmsfree@gap200`. Run one rung per command here: if you list several
rungs, each is compared with the rung before it under the same tags instead. The report flags the power-state
difference; that is expected. If holding clocks high removes most of the gap penalty, keep it in production.

**With the RCA LLM running.** Start the LLM doing what it does in production, then run the chosen variant with a
tag. If the chosen variant is a PyTorch rung, try the high-priority stream as well:

```bash
TAG=contended SKIP_TUNE=1 ONLY="hipgraph hipgraph+hiprio" KNOBS="hipgraph+hiprio" \
MODEL=best.pt IMAGES=data/test_images LABELS=data/test_labels IMGSZ=800 bash yolo_rocm_bench/run_all.sh
```

`hipgraph@contended` is compared with the quiet `hipgraph`. That difference is the real p95 cost of sharing the GPU.
`hipgraph+hiprio@contended` is compared with `hipgraph@contended`, which shows whether stream priority helps.
Replace `hipgraph` with your pick.

**In the container.** Production runs the ML service under Docker Compose, so confirm the winner once inside that
container. Give it the GPU with `--device /dev/kfd --device /dev/dri --group-add video --group-add render`, mount
`~/yolo_bench`, install the same packages as in step 2, and run the variant with `TAG=docker`.

## 9. Read the report and decide

`results/report.md` has one table per batch size. Every row shows:

- p50, p95 and images/s.
- Δp50 against the row it is compared with.
- Cold start (load, first call, compile or graph capture).
- The pre / inference / post split per image.
- Box agreement (recall / mIoU) with its parent and with `baseline`.
- With labels: precision / recall / mIoU against the ground truth.
- Notes.

Under each table, the decision lines name the fastest variant that passes the accuracy bar, the simplest variant
that meets `TARGET_P95`, and the knobs worth keeping.

The rules behind those lines, so you can apply them by hand:

| If the report shows | It means | Do this |
|---|---|---|
| `failed` / `skipped` | The method did not run on this stack | Read its log; see Troubleshooting |
| `gain < 5%: drop` | The step does not pay on this model and GPU | Leave it out, especially if its cold start is long |
| `changes detections` (agreement with parent below recall 0.98 / mIoU 0.95) | The step moves boxes | Check its label columns before keeping it |
| `different head: judge on labels` on `nmsfree` | Expected: a different head, not a numerical error | Keep it if label recall and mIoU stay within 0.02 of `baseline` |
| `pre-processing bound` | Letterbox and upload cost as much as inference | Check the pre-processing table; build the GPU letterbox if it says it pays |
| `migraphx_ep` or `mgx_*` clearly below the best PyTorch row | The compiled engine pays | Adopt it if the margin justifies a second runtime (15–20% or more is a reasonable bar) |
| `mgx_int8` faster than `mgx_fp16` with label numbers held | INT8 is free for this model | Adopt it; otherwise stay on FP16 |
| Low GPU busy % in "Where the time goes" | Launch and CPU overhead dominate | HIP graphs and MIGraphX help most |
| High GPU busy % | The kernels dominate | Tuning, FP16 and INT8 help most |

Adopt the lowest rung that meets the line's p95 and passes the accuracy bar, at the batch size you will deploy.
Climb further only when a step clearly pays.

Change the bars with `report.py` flags and rebuild the report without re-running anything:

```bash
python yolo_rocm_bench/report.py --out results --labels data/test_labels --target-p95 30 \
    --min-gain 5 --recall-bar 0.98 --miou-bar 0.95 --gt-tol 0.02
```

## Outputs

```text
results/
  report.md, summary.csv     the report, and every number in one CSV
  compare.md                 run-to-run drift (written into the second folder)
  runs/<name>_b<B>.json      one per run: timings, cold start, stage split, versions, env vars, power state, errors
  dets/<name>_b<B>.json      boxes per image, used for agreement and label metrics
  traces/<name>_b<B>.json    torch.profiler traces; open in https://ui.perfetto.dev
  preproc/, tune/, logs/     micro-benchmark results, tuning-pass records, one log per step
  env_torch.json             the environment check
artifacts/                   ONNX exports (<stem>_b<B>_<imgsz>_fp32/fp16.onnx) and compiled .mxr engines
.cache/                      MIOpen perf DB and kernels, TunableOp results, MIGraphX EP programs
```

Keep `.cache/` and `artifacts/` when you deploy: they are the tuned kernels and compiled engines. Without them,
the first start after a reboot pays the compile and tuning cost again.

## How the numbers are taken

- **Clock boundaries.** The clock starts with decoded BGR frames in memory and stops when boxes in original-image
  pixels are on the CPU. Disk reads and JPEG decode are excluded. The GPU is synchronised before and after each call.
- **Warm-up.** One pass over every image (so `rect=True` rungs have met every input shape), then `WARMUP` batches.
  The first call is recorded separately as cold start.
- **Isolation.** One run per process, so MIOpen state, compiled graphs and allocator state never carry over.
- **Reproducible MIOpen state.** `baseline`, `fp16` and `static` always start from an empty MIOpen user DB.
  `tuned` and later rungs use the tuned DB in `.cache/miopen-db`. Delete it to reproduce a cold deployment.
- **Same inputs.** Every run sees the same images in the same order, confidence 0.25 and NMS IoU 0.7 where NMS
  runs. Each call gets exactly `BATCH` images; the accuracy pass pads its last batch and discards the padding.
- **Fair MIGraphX rows.** The raw MIGraphX runner uses a letterbox and box rescaling that match Ultralytics
  bit-for-bit, so those rows measure the runtime, not a different pipeline.
- **Ultralytics overhead.** Ultralytics' own stage timers synchronise the GPU three times per call. That cost is in
  every Ultralytics row alike.

## Deeper profiling

The report's profile table comes from torch.profiler. For a full kernel timeline of one rung, use ROCm's
profiler on a short run (check `rocprofv3 --help` for the exact flags on your install):

```bash
rocprofv3 --kernel-trace --stats --output-format csv -d prof_nmsfree -- \
    python yolo_rocm_bench/bench_ultralytics.py --variant nmsfree --model best.pt --images data/test_images \
    --batch 1 --imgsz 800 --iters 20 --warmup 5 --no-accuracy --out results_prof
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `PyTorch is not a ROCm build` | A later install pulled torch from PyPI | Re-run step 2a, then 2c with `-c constraints-rocm.txt` |
| `no access to /dev/kfd` / GPU not visible | User not in `render`/`video` | `sudo usermod -aG render,video $USER`, then log out and in |
| `gcn_arch is ..., not gfx1151` | Different GPU or wrong wheel extra | Use the `device-<arch>` extra that matches |
| `HSA_OVERRIDE_GFX_VERSION is set` | Left over from older instructions | `unset HSA_OVERRIDE_GFX_VERSION`, and remove it from `~/.bashrc` |
| `ImportError: libGL.so.1` when importing cv2 | Headless server without GL | `sudo apt install libgl1` |
| `migraphx_ep` failed: `not on the MIGraphX EP: ['CPUExecutionProvider']` | The plugin failed to load or compile; Ultralytics fell back to the CPU | The log above has `MIGraphX execution provider unavailable (...)`. Check `env_check.py`'s MIGraphX EP line. If `pip list` shows `migraphx-libs 2.17`, something auto-installed it: re-run step 2b |
| `pip list` shows `migraphx 0.0.1` or `onnxruntime-ep-migraphx 0.0.0`, or `migraphx` has no `parse_onnx` | PyPI placeholder installed instead of AMD's build | `pip uninstall -y migraphx migraphx-libs onnxruntime-ep-migraphx`, then reinstall with exact `==...+rocm...` pins (step 2b) |
| MIGraphX cannot parse the ONNX / unsupported op | Opset or operator not supported | `python yolo_rocm_bench/export_onnx.py --model best.pt --batch 1 8 --imgsz 800 --opset 17 --force` |
| `engine input is [...] but --batch ...` | ONNX for another batch size | Export that batch size (the file name carries `_b<B>_<imgsz>`) |
| `compile` failed, or `torch.compile built no graph` | Inductor/Triton cannot compile for gfx1151 | The log has the reason. Drop the compile rungs; `hipgraph` gives the graph benefit without a compiler |
| `hipgraph` failed during capture | An op in the network cannot be captured on ROCm | Drop the rung, or try `compile_graphs` |
| `mgx_int8` skipped | No `CALIB` folder | Pass `CALIB=data/calib_images` |
| `mgx_int8` slower than `mgx_fp16`, or loses label recall | No fast INT8 kernels for some layers, or too few calibration images | Stay on FP16; with more line images, recalibrate (a new set rebuilds the engine automatically) |
| Tuning or the first MIGraphX run takes many minutes | One-time tuning and compiles | Expected; cached in `.cache/` and `artifacts/`. `--rebuild` on `bench_migraphx.py` forces a recompile |
| p50 moves more than 5% between runs | Background load, the LLM, or a power-state change | Quiet the machine, use `gpu_perf.sh`, and re-run |
| Report warns "Power state changed between runs" | Rows measured under different clocks or governors | Compare only rows within one state, or re-run them under one |
| Profile note "no GPU kernel events" | torch.profiler has no GPU activity support in this build | Use `rocprofv3` (above) |

### Plan B: the ROCm 10.0 stack Ultralytics validated

Use this only if the MIGraphX rungs fail on ROCm 10.1 and the fix is not obvious. Ultralytics 8.4.176 pins its
MIGraphX plugin to these builds and published 8060S benchmarks with them. AMD's docs, however, list gfx1151 for
MIGraphX only from 2.18 (ROCm 10.1), and your earlier `invalid argument` errors were on a ROCm 10.0 torch. Use a
separate venv and skip the constraints file:

```bash
python3.12 -m venv ~/venvs/yolo-rocm100 && source ~/venvs/yolo-rocm100/bin/activate
python -m pip install --index-url https://stable.repo.amd.com/rocm/whl-next/ \
    "torch[device-gfx1151]==2.13.0+rocm10.0.0" "torchvision[device-gfx1151]==0.28.0+rocm10.0.0"
python -m pip install "onnxruntime~=1.29.0"
python -m pip install --index-url https://stable.repo.amd.com/rocm/migraphx/whl-next/ \
    --extra-index-url https://stable.repo.amd.com/rocm/onnxruntime/whl-next/ \
    "migraphx==2.17.0+rocm10.0.0" "migraphx-libs==2.17.0+rocm10.0.0" "onnxruntime-ep-migraphx==1.0.0+rocm10.0.0"
python -m pip install -r yolo_rocm_bench/requirements.txt
python -m pip list 2>/dev/null | grep -i -E "nvidia|torch|rocm|migraphx|onnxruntime"   # no nvidia-*, no 0.0.x
```

## Files

| File | Role |
|---|---|
| `run_all.sh` | Runs everything in order, one log per step, keeps going past failures |
| `bench_ultralytics.py` | PyTorch rungs, `migraphx_ep`, knobs, the MIOpen tuning pass (`--tune`), profiling |
| `bench_migraphx.py` | Raw MIGraphX FP16/INT8; `--engine ort-cpu` checks its pre/post-processing on any machine |
| `export_onnx.py` | Static FP32 and FP16 ONNX per batch size, NMS-free head |
| `bench_preproc.py` | CPU letterbox vs pinned copy vs GPU letterbox |
| `report.py` | `report.md`, `summary.csv`, and `--compare` for run-to-run drift |
| `env_check.py` | Stack check before a run |
| `prepare_data.py` | Test, label and calibration folders from a YOLO dataset (default: the bundled one) |
| `datasets/silicon-wafer/` | The bundled wafer dataset (train / valid / test, YOLO format) |
| `gpu_perf.sh` | Show or set GPU performance level, power profile, CPU governor, platform profile |
| `common.py` | Ladder, knobs, Ultralytics-exact letterbox, metrics, result files (no torch); `python common.py selftest` checks the letterbox against Ultralytics |
| `requirements.txt` | The PyPI dependencies (ultralytics, onnx, onnxslim, onnxruntime), unpinned; versions come from a constraints file |
| `constraints-rocm.txt` | Pins for the ROCm 10.1 stack that keep pip from replacing the AMD builds; use your own file instead if it worked before |
