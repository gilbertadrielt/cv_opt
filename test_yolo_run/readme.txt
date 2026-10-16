YOLO26 INFERENCE LATENCY BENCHMARK
===================================

SETUP (already done in this folder)
------------------------------------
.venv\            virtual env with ultralytics installed
weights\          pre-downloaded checkpoints: yolo26n/s/m/l/x.pt
input_images\     put your test images here (.jpg/.jpeg/.png/.bmp/.webp)
output_images\    results land here (created automatically)

On a new machine, recreate the venv with:
    python -m venv .venv
    .venv\Scripts\pip install -r requirements.txt

This plain requirements.txt is fine for CPU-only dev/test boxes (like this
Windows machine). On Linux it will pull the default CUDA build of torch even
if you don't have an NVIDIA GPU -- pip doesn't detect your hardware, it just
grabs PyPI's default wheel.

ON THE AMD ROCM BOX (Strix Halo / gfx1151, e.g. NucBox EVO-X2):
Use requirements-rocm.txt instead, which pins torch/torchvision to AMD's
ROCm 10.0.0 wheels for gfx1151 so pip never touches PyPI for those two
packages (no stray nvidia-cudnn/cublas/nccl downloads):
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements-rocm.txt

Before it'll actually see the GPU, your Linux user must be in the "render"
and "video" groups (owns /dev/kfd and /dev/dri/renderD*). This requires
sudo, run once by whoever admins the box, then a full logout/login:
    sudo usermod -aG render,video <your_username>
Verify with:
    python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)"
If that still prints False after a real re-login, try forcing the gfx
target recognition:
    HSA_OVERRIDE_GFX_VERSION=11.5.1 python -c "import torch; print(torch.cuda.is_available())"


HOW TO RUN
------------------------------------
Activate the venv, then run benchmark.py. Basic example:

    .venv\Scripts\python benchmark.py --model_size nano --batch_size 3

Full example with all options:

    .venv\Scripts\python benchmark.py ^
        --model_size medium ^
        --batch_size 4 ^
        --imgsz 640 ^
        --conf 0.25 ^
        --device auto ^
        --warmup_batches 1 ^
        --input_dir input_images ^
        --output_dir output_images ^
        --weights_dir weights

(Windows cmd.exe line-continuation is "^"; in PowerShell use a backtick "`"
 instead, or just put everything on one line.)


ARGUMENTS
------------------------------------
--model_size     nano | small | medium | large | xlarge   (default: nano)
                 maps to yolo26n / yolo26s / yolo26m / yolo26l / yolo26x
--batch_size     images per inference batch                (default: 1)
--imgsz          model input resolution                    (default: 640)
--conf           confidence threshold                       (default: 0.25)
--device         auto | cpu | cuda | cuda:0 ...              (default: auto)
                 "auto" picks cuda/ROCm if available, else cpu
--warmup_batches batches run before timing starts, to prime
                 the device (not counted in the average)     (default: 1)
--input_dir      folder of source images                    (default: input_images)
--output_dir     folder where run results are written        (default: output_images)
--weights_dir    folder where .pt checkpoints are cached      (default: weights)


OUTPUT
------------------------------------
Each run creates:
    output_images\<model>_<YYYYMMDD_HHMMSS>\
        <same filenames as input>.jpg   -- annotated images (boxes + labels)
        summary.txt                     -- run config + average timings

It also appends one row per run to:
    output_images\benchmark_results.csv

...so you can line up nano vs small vs medium vs large vs xlarge results
side by side across runs.

Console output reports two timing numbers per run:
  - avg_pure_inference_ms_per_batch  -> just the model forward pass
  - avg_end_to_end_ms_per_batch      -> preprocess + inference + postprocess
                                         + drawing boxes + saving the image


EXAMPLE BENCHMARK SWEEP
------------------------------------
.venv\Scripts\python benchmark.py --model_size nano   --batch_size 1
.venv\Scripts\python benchmark.py --model_size small  --batch_size 1
.venv\Scripts\python benchmark.py --model_size medium --batch_size 1
.venv\Scripts\python benchmark.py --model_size large  --batch_size 1
.venv\Scripts\python benchmark.py --model_size xlarge --batch_size 1
Then check output_images\benchmark_results.csv for the comparison.
