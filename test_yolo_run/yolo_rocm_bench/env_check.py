"""Check the ROCm stack before a run: PyTorch build and GPU arch, Ultralytics arguments, compile and HIP-graph
support, the MIGraphX EP and raw MIGraphX, and the power state. Writes <out>/env_torch.json (or env_migraphx.json).

    python env_check.py --out results                  # in the PyTorch venv
    python env_check.py --out results --migraphx-only  # in a separate MIGraphX venv, if you use one

Prints `OK: environment ready` when nothing FAILs. WARN items only affect the rungs they name.
"""

from __future__ import annotations

import argparse
import os
import sys
import traceback
from importlib import metadata
from pathlib import Path

import common as C

RESULTS = []


def check(label: str, fn, warn_only: bool = False):
    """Run one check; fn returns a detail string or raises. Records PASS/WARN/FAIL."""
    try:
        detail = fn()
        status = "PASS"
    except Exception as e:
        detail = f"{type(e).__name__}: {e}".splitlines()[0][:200]
        status = "WARN" if warn_only else "FAIL"
    RESULTS.append({"check": label, "status": status, "detail": str(detail)})
    print(f"  {status:<4}  {label:<34} {detail}")


def version(pkg: str) -> str:
    return metadata.version(pkg)


def torch_checks():
    import torch

    def build():
        if not torch.version.hip:
            raise RuntimeError(f"PyTorch is not a ROCm build ({torch.__version__}); reinstall the torch[device-gfx1151] wheel")
        return f"torch {torch.__version__}, HIP {torch.version.hip}"

    def device():
        if not torch.cuda.is_available():
            raise RuntimeError("PyTorch cannot see the GPU: check render/video groups and /dev/kfd")
        p = torch.cuda.get_device_properties(0)
        arch = getattr(p, "gcnArchName", "?")
        if not arch.startswith("gfx1151"):
            raise RuntimeError(f"gcn_arch is {arch}, not gfx1151 ({p.name})")
        return f"{p.name}, {arch}, {p.total_memory / 2**30:.1f} GiB visible"

    def archs():
        a = torch.cuda.get_arch_list()
        if not any(x.startswith("gfx1151") for x in a):
            raise RuntimeError(f"wheel built for {a}, no gfx1151 kernels")
        return ", ".join(a)

    def conv_fp16():
        x = torch.randn(1, 64, 160, 160, device="cuda", dtype=torch.float16)
        w = torch.randn(64, 64, 3, 3, device="cuda", dtype=torch.float16)
        y = torch.nn.functional.conv2d(x, w, padding=1)
        torch.cuda.synchronize()
        return f"MIOpen fp16 conv ok, mean {y.float().mean().item():.4f}"

    def hip_graph():
        x = torch.randn(1024, device="cuda")
        g = torch.cuda.CUDAGraph()
        s = torch.cuda.Stream()
        s.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(s):
            y = x * 2 + 1
        torch.cuda.current_stream().wait_stream(s)
        with torch.cuda.graph(g):
            y = x * 2 + 1
        x.fill_(1.0)
        g.replay()
        torch.cuda.synchronize()
        assert float(y[0]) == 3.0, "graph replay gave a wrong value"
        return "capture + replay ok (hipgraph rung can run)"

    def triton():
        import triton

        return f"triton {triton.__version__}"

    def compile_smoke():
        fn = torch.compile(lambda a: torch.nn.functional.silu(a * 2 + 1), backend="inductor")
        y = fn(torch.randn(4096, device="cuda"))
        torch.cuda.synchronize()
        return f"inductor compiled and ran on the GPU, mean {y.mean().item():.4f}"

    check("PyTorch ROCm build", build)
    check("GPU visible + arch", device)
    check("wheel arch list", archs, warn_only=True)
    check("fp16 convolution (MIOpen)", conv_fp16)
    check("HIP graph capture", hip_graph, warn_only=True)
    check("Triton", triton, warn_only=True)
    if not ARGS.skip_compile_smoke:
        check("torch.compile smoke test", compile_smoke, warn_only=True)

    def ultra():
        os.environ["YOLO_AUTOINSTALL"] = "False"
        import ultralytics
        from ultralytics.cfg import DEFAULT_CFG_DICT

        missing = [k for k in ("quantize", "nms", "compile", "channels_last") if k not in DEFAULT_CFG_DICT]
        if missing:
            raise RuntimeError(f"Ultralytics {ultralytics.__version__} lacks {missing}; pip install -U ultralytics")
        if DEFAULT_CFG_DICT["nms"] is not None:
            raise RuntimeError(f"nms default is {DEFAULT_CFG_DICT['nms']!r}, expected None (one-to-many + NMS)")
        return f"ultralytics {ultralytics.__version__}: quantize, nms, compile, channels_last present"

    check("Ultralytics arguments", ultra)
    check("onnx / onnxslim", lambda: f"onnx {version('onnx')}, onnxslim {version('onnxslim')}")

    def ep():
        import onnxruntime
        from ultralytics.nn.backends.onnx import _register_migraphx_ep

        name = _register_migraphx_ep(onnxruntime)
        devices = [d for d in onnxruntime.get_ep_devices() if d.ep_name == name]
        if not devices:
            raise RuntimeError(f"{name} registered but enumerates no GPU")
        return (
            f"onnxruntime {onnxruntime.__version__}, ep {version('onnxruntime-ep-migraphx')}, "
            f"migraphx-libs {version('migraphx-libs')}, {len(devices)} device(s)"
        )

    check("MIGraphX EP (migraphx_ep rung)", ep, warn_only=True)


def migraphx_checks():
    def mgx():
        import migraphx

        migraphx.get_target("gpu")
        return f"migraphx {version('migraphx')}, migraphx-libs {version('migraphx-libs')}, gpu target ok"

    check("raw MIGraphX (mgx_* rungs)", mgx, warn_only=not ARGS.migraphx_only)


def system_checks():
    def python():
        if sys.version_info[:2] != (3, 12):
            raise RuntimeError(f"Python {sys.version.split()[0]}; the MIGraphX wheels are cp312 only")
        return sys.version.split()[0]

    def kfd():
        if not os.access("/dev/kfd", os.R_OK | os.W_OK):
            raise PermissionError("no access to /dev/kfd: add your user to the render and video groups, log in again")
        return "ok"

    check("python", python, warn_only=True)
    check("/dev/kfd access", kfd)
    def kfd_arch():
        arch = C.gpu_arch_from_kfd()
        if not arch:
            raise RuntimeError("no GPU node in /sys/class/kfd topology")
        return arch

    check("KFD gfx target", kfd_arch, warn_only=True)

    def override():
        v = os.environ.get("HSA_OVERRIDE_GFX_VERSION")
        if v:
            raise RuntimeError(f"HSA_OVERRIDE_GFX_VERSION={v} is set; unset it with native gfx1151 wheels")
        return "not set"

    check("HSA_OVERRIDE_GFX_VERSION", override, warn_only=True)
    state = C.system_state()
    cards = {k: v for k, v in state.items() if k.startswith("card")}
    for card, s in cards.items():
        check(f"{card} perf level / profile", lambda s=s: f"{s['perf_level']} / {s['power_profile']}", warn_only=True)
    check("CPU governor / platform profile", lambda: f"{state['cpu_governor']} / {state['platform_profile']}", warn_only=True)
    return state


def main() -> int:
    global ARGS
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default="results")
    p.add_argument("--migraphx-only", action="store_true")
    p.add_argument("--skip-compile-smoke", action="store_true", help="skip the ~30-60 s torch.compile check")
    ARGS = p.parse_args()

    print("ENVIRONMENT CHECK")
    state = system_checks()
    try:
        if not ARGS.migraphx_only:
            torch_checks()
        migraphx_checks()
    except Exception:
        traceback.print_exc()
        RESULTS.append({"check": "harness", "status": "FAIL", "detail": "unexpected error, see traceback"})

    fails = [r for r in RESULTS if r["status"] == "FAIL"]
    name = "env_migraphx.json" if ARGS.migraphx_only else "env_torch.json"
    C.write_json(Path(ARGS.out) / name, {"checks": RESULTS, "system": state, "env": C.env_snapshot()})
    print()
    print("OK: environment ready" if not fails else f"NOT READY: {len(fails)} check(s) failed")
    return 1 if fails else 0


ARGS = None

if __name__ == "__main__":
    sys.exit(main())
