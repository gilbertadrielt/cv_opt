"""ROCm / gfx1151 triage for the YOLO26 benchmark.

Bisects `torch.AcceleratorError: CUDA error: invalid argument` down to the one
ROCm library that is actually broken, by exercising each layer of the stack on
its own: allocator -> memcpy -> torch's own kernels -> rocBLAS -> MIOpen ->
torchvision -> the full YOLO forward.

Each stage runs in its own subprocess. A HIP error poisons the context, so
without that isolation every stage after the first failure fails too and you
can't tell which one is the real culprit.

Usage (on the Strix Halo box, inside the venv):
    python rocm_triage.py              # environment report + every stage
    python rocm_triage.py --stage 9    # run one stage in this process
    python rocm_triage.py --inline     # all stages in one process (cascades)
    python rocm_triage.py --list       # what the stages are

Worth re-running with AMD_SERIALIZE_KERNEL=3 set, which makes HIP block after
every launch so the traceback points at the kernel that actually failed rather
than wherever the async error happened to surface.
"""

import argparse
import os
import subprocess
import sys
import traceback
from pathlib import Path

# Env vars that change which kernels get loaded or how they're launched.
RELEVANT_ENV = [
    "HSA_OVERRIDE_GFX_VERSION",
    "PYTORCH_ROCM_ARCH",
    "PYTORCH_HIP_ALLOC_CONF",
    "PYTORCH_CUDA_ALLOC_CONF",
    "TORCH_BLAS_PREFER_HIPBLASLT",
    "MIOPEN_FIND_MODE",
    "MIOPEN_DEBUG_CONV_IMPLICIT_GEMM",
    "MIOPEN_USER_DB_PATH",
    "HIP_VISIBLE_DEVICES",
    "ROCR_VISIBLE_DEVICES",
    "CUDA_VISIBLE_DEVICES",
    "GPU_MAX_HW_QUEUES",
    "HSA_ENABLE_SDMA",
    "AMD_SERIALIZE_KERNEL",
    "ROCM_PATH",
    "LD_LIBRARY_PATH",
]


# --------------------------------------------------------------------------
# Environment report
# --------------------------------------------------------------------------

def _safe(label, fn):
    try:
        print(f"  {label:<34} {fn()}")
    except Exception as e:
        print(f"  {label:<34} <{type(e).__name__}: {e}>")


def report_env():
    print("=" * 78)
    print("ENVIRONMENT")
    print("=" * 78)

    print("\n[env vars]")
    for key in RELEVANT_ENV:
        val = os.environ.get(key)
        if val is None:
            continue
        if len(val) > 120:
            val = val[:117] + "..."
        flag = "  <-- unset this first" if key == "HSA_OVERRIDE_GFX_VERSION" else ""
        print(f"  {key}={val}{flag}")
    if not any(k in os.environ for k in RELEVANT_ENV):
        print("  (none set)")

    print("\n[torch]")
    try:
        import torch
    except Exception:
        traceback.print_exc()
        return

    _safe("torch.__version__", lambda: torch.__version__)
    _safe("torch.version.hip", lambda: torch.version.hip)
    _safe("torch.version.cuda", lambda: torch.version.cuda)
    _safe("built-for archs", lambda: ", ".join(torch.cuda.get_arch_list()))
    _safe("is_available()", lambda: torch.cuda.is_available())
    _safe("device_count()", lambda: torch.cuda.device_count())

    try:
        props = torch.cuda.get_device_properties(0)
        _safe("device name", lambda: props.name)
        _safe("device gcnArchName", lambda: getattr(props, "gcnArchName", "?"))
        _safe("device total_memory (GiB)", lambda: f"{props.total_memory / 2**30:.1f}")
        _safe("device multi_processor_count", lambda: props.multi_processor_count)
    except Exception as e:
        print(f"  {'device properties':<34} <{type(e).__name__}: {e}>")

    print("\n[ROCm libs bundled inside the wheel]")
    libdir = Path(torch.__file__).parent / "lib"
    print(f"  {libdir}")
    if libdir.is_dir():
        interesting = ("amdhip", "rocblas", "hipblaslt", "MIOpen", "miopen",
                       "rocfft", "hiprtc", "amd_comgr", "rccl", "hsa")
        names = sorted(p.name for p in libdir.glob("*.so*")
                       if any(tag in p.name for tag in interesting))
        for name in names:
            print(f"    {name}")
        if not names:
            print("    (no bundled ROCm .so found -- wheel links against system ROCm)")

    # rocBLAS ships one Tensile blob per architecture. No gfx1151 file here
    # means no GEMM kernels for this GPU, whatever torch's arch list claims.
    _report_arch_assets(libdir / "rocblas" / "library", "rocBLAS Tensile libraries")
    _report_arch_assets(libdir / "miopen" / "share" / "miopen" / "db", "MIOpen kernel/perf dbs")
    _report_arch_assets(libdir / "miopen" / "db", "MIOpen kernel/perf dbs (alt path)")

    print("\n[system ROCm, for comparison with the wheel's copy]")
    _report_cmd(["hipconfig", "--version"])
    _report_cmd(["rocminfo"], grep="gfx")
    _report_cmd(["rocm-smi", "--showmeminfo", "vram"])
    print()


def _report_arch_assets(path, label):
    if not path.is_dir():
        return
    archs = sorted({
        part
        for p in path.iterdir()
        for part in p.name.replace(".", "_").split("_")
        if part.startswith("gfx")
    })
    print(f"\n  [{label}] {path}")
    print(f"    archs present: {', '.join(archs) if archs else '(none found in filenames)'}")
    if archs and not any(a.startswith("gfx1151") for a in archs):
        print("    !! no gfx1151 asset here -- this library has no kernels for your GPU")


def _report_cmd(cmd, grep=None):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except Exception as e:
        print(f"  $ {' '.join(cmd)} -> <{type(e).__name__}: {e}>")
        return
    lines = (out.stdout + out.stderr).splitlines()
    if grep:
        lines = sorted({ln.strip() for ln in lines if grep in ln})
    lines = [ln for ln in lines if ln.strip()][:12]
    print(f"  $ {' '.join(cmd)}")
    for ln in lines:
        print(f"    {ln}")


# --------------------------------------------------------------------------
# Stages, cheapest and lowest-level first
# --------------------------------------------------------------------------

def stage_visible():
    """HSA/HIP sees the GPU at all (driver, permissions, /dev/kfd)."""
    import torch
    assert torch.cuda.is_available(), "torch.cuda.is_available() is False"
    props = torch.cuda.get_device_properties(0)
    return f"{props.name} / {getattr(props, 'gcnArchName', '?')}"


def stage_allocate():
    """Caching allocator -> hipMalloc on the UMA carve-out."""
    import torch
    x = torch.empty(64 * 1024 * 1024 // 4, device="cuda")  # 64 MiB
    torch.cuda.synchronize()
    return f"allocated {x.numel() * 4 / 2**20:.0f} MiB"


def stage_copy():
    """hipMemcpy both directions, pageable host memory."""
    import torch
    host = torch.randn(1024, 1024)
    dev = host.to("cuda")
    back = dev.cpu()
    torch.cuda.synchronize()
    assert torch.equal(host, back), "round-trip mismatch"
    return "H2D + D2H round trip exact"


def stage_pinned_copy():
    """hipHostMalloc + async copy. A known sore spot on APUs/iGPUs."""
    import torch
    host = torch.randn(1024, 1024).pin_memory()
    dev = host.to("cuda", non_blocking=True)
    torch.cuda.synchronize()
    return f"pinned copy ok, sum={dev.sum().item():.3f}"


def stage_elementwise():
    """torch's OWN fatbin kernels. Failure here = wheel has no gfx1151 code."""
    import torch
    x = torch.randn(4096, 4096, device="cuda")
    y = torch.nn.functional.silu(x * 2.0 + 1.0)  # SiLU is YOLO's activation
    torch.cuda.synchronize()
    return f"silu(2x+1) mean={y.mean().item():.5f}"


def stage_reduction():
    """Reductions / sort-ish ops used all over YOLO postprocessing."""
    import torch
    x = torch.randn(1, 84, 8400, device="cuda")
    conf, cls = x.max(dim=1)
    top = conf.topk(300, dim=1)
    torch.cuda.synchronize()
    return f"max+topk ok, best={top.values.max().item():.4f} cls={cls.flatten()[0].item()}"


def stage_matmul_fp32():
    """rocBLAS sgemm."""
    import torch
    a = torch.randn(2048, 2048, device="cuda")
    b = torch.randn(2048, 2048, device="cuda")
    c = a @ b
    torch.cuda.synchronize()
    return f"2048^3 sgemm, mean={c.mean().item():.5f}"


def stage_matmul_fp16():
    """hipBLASLt half-precision path (different kernels from fp32)."""
    import torch
    a = torch.randn(2048, 2048, device="cuda", dtype=torch.float16)
    b = torch.randn(2048, 2048, device="cuda", dtype=torch.float16)
    c = a @ b
    torch.cuda.synchronize()
    return f"2048^3 hgemm, mean={c.float().mean().item():.5f}"


def stage_conv_fp32():
    """MIOpen convolution -- this is where essentially all of YOLO lives."""
    import torch
    import torch.nn.functional as F
    x = torch.randn(1, 3, 640, 640, device="cuda")
    w = torch.randn(16, 3, 3, 3, device="cuda")
    y = F.conv2d(x, w, stride=2, padding=1)
    torch.cuda.synchronize()
    return f"conv2d {tuple(y.shape)} mean={y.mean().item():.5f}"


def stage_conv_fp16():
    """MIOpen half-precision convolution (separate kernel set from fp32)."""
    import torch
    import torch.nn.functional as F
    x = torch.randn(1, 64, 160, 160, device="cuda", dtype=torch.float16)
    w = torch.randn(64, 64, 3, 3, device="cuda", dtype=torch.float16)
    y = F.conv2d(x, w, padding=1)
    torch.cuda.synchronize()
    return f"conv2d fp16 {tuple(y.shape)} mean={y.float().mean().item():.5f}"


def stage_backbone_ops():
    """BatchNorm, maxpool, upsample, cat -- the rest of the YOLO backbone."""
    import torch
    import torch.nn.functional as F
    x = torch.randn(1, 64, 160, 160, device="cuda")
    bn = torch.nn.BatchNorm2d(64).to("cuda").eval()
    y = bn(x)
    y = F.max_pool2d(y, kernel_size=5, stride=1, padding=2)   # SPPF
    y = F.interpolate(y, scale_factor=2, mode="nearest")      # neck upsample
    y = torch.cat([y, y], dim=1)
    torch.cuda.synchronize()
    return f"bn+maxpool+interpolate+cat -> {tuple(y.shape)}"


def stage_torchvision():
    """torchvision's compiled HIP extension (separate build from torch)."""
    import torch
    import torchvision
    from torchvision.ops import nms
    boxes = torch.rand(2000, 4, device="cuda")
    boxes[:, 2:] += boxes[:, :2]
    scores = torch.rand(2000, device="cuda")
    keep = nms(boxes, scores, 0.5)
    torch.cuda.synchronize()
    return f"torchvision {torchvision.__version__}, nms kept {keep.numel()}"


def stage_yolo():
    """The real thing: ultralytics YOLO26 forward on a synthetic frame."""
    import numpy as np
    from ultralytics import YOLO
    weights = Path(__file__).parent / "weights" / "yolo26n.pt"
    model = YOLO(str(weights) if weights.exists() else "yolo26n")
    model.to("cuda")
    frame = np.zeros((640, 640, 3), dtype=np.uint8)
    results = model.predict(frame, imgsz=640, device="cuda", verbose=False)
    return f"predict ok, {len(results[0].boxes)} boxes, {results[0].speed['inference']:.1f} ms"


STAGES = [
    ("device visible",        stage_visible),
    ("device allocation",     stage_allocate),
    ("H2D/D2H memcpy",        stage_copy),
    ("pinned memcpy",         stage_pinned_copy),
    ("elementwise + SiLU",    stage_elementwise),
    ("reduction + topk",      stage_reduction),
    ("matmul fp32 (rocBLAS)", stage_matmul_fp32),
    ("matmul fp16 (hipBLASLt)", stage_matmul_fp16),
    ("conv2d fp32 (MIOpen)",  stage_conv_fp32),
    ("conv2d fp16 (MIOpen)",  stage_conv_fp16),
    ("backbone ops",          stage_backbone_ops),
    ("torchvision nms",       stage_torchvision),
    ("full YOLO26 predict",   stage_yolo),
]


# --------------------------------------------------------------------------
# Runners
# --------------------------------------------------------------------------

def run_stage(index):
    name, fn = STAGES[index - 1]
    print(f"stage {index}: {name}")
    detail = fn()
    print(f"  -> {detail}")


def run_all(isolated=True):
    print("=" * 78)
    print("STAGES" + ("" if isolated else "  (inline -- failures WILL cascade)"))
    print("=" * 78)

    first_failure = None
    for index, (name, fn) in enumerate(STAGES, start=1):
        label = f"  {index:>2}. {name:<26}"
        if isolated:
            proc = subprocess.run(
                [sys.executable, os.path.abspath(__file__), "--stage", str(index)],
                capture_output=True, text=True,
            )
            ok = proc.returncode == 0
            output = (proc.stdout + proc.stderr).strip()
        else:
            try:
                detail = fn()
                ok, output = True, f"  -> {detail}"
            except Exception:
                ok, output = False, traceback.format_exc()

        if ok:
            tail = [ln for ln in output.splitlines() if ln.strip().startswith("->")]
            print(f"{label} PASS   {tail[-1].strip()[3:] if tail else ''}")
        else:
            print(f"{label} FAIL")
            for line in output.splitlines():
                print(f"        {line}")
            if first_failure is None:
                first_failure = (index, name)

    print()
    print("=" * 78)
    if first_failure is None:
        print("All stages passed. The failure is above this layer -- in the benchmark's")
        print("own code path, a specific model size, or batching. Re-run benchmark.py")
        print("with --batch_size 1 --model_size nano and compare.")
    else:
        index, name = first_failure
        print(f"FIRST FAILURE: stage {index} -- {name}")
        print("That stage names the guilty library. Everything below it is fine.")
    print("=" * 78)
    return 0 if first_failure is None else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stage", type=int, help="Run one stage in this process.")
    parser.add_argument("--inline", action="store_true",
                        help="Run every stage in this process instead of isolating them.")
    parser.add_argument("--list", action="store_true", help="List the stages and exit.")
    parser.add_argument("--skip-env", action="store_true", help="Skip the environment report.")
    args = parser.parse_args()

    if args.list:
        for index, (name, fn) in enumerate(STAGES, start=1):
            print(f"{index:>2}. {name:<26} {(fn.__doc__ or '').strip()}")
        return 0

    if args.stage is not None:
        if not 1 <= args.stage <= len(STAGES):
            parser.error(f"--stage must be 1..{len(STAGES)}")
        try:
            run_stage(args.stage)
        except Exception:
            traceback.print_exc()
            return 1
        return 0

    if not args.skip_env:
        report_env()
    return run_all(isolated=not args.inline)


if __name__ == "__main__":
    sys.exit(main())
