"""Build report.md and summary.csv from the per-run JSON files; optionally compare two full runs for drift.

    python report.py --out results --labels data/test_labels --target-p95 30
    python report.py --out results --compare results_run2     # p50 drift per run between two full runs

Every row is compared with its parent (the rung, knob-less or untagged run it adds one change to) and with
`baseline`: speed change, plus how well its boxes agree. With --labels, ground-truth precision/recall/mIoU too.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

import common as C

ORDER = {v: i for i, v in enumerate(C.VARIANTS)}


def load_runs(out: Path) -> dict:
    runs = {}
    for f in sorted((out / "runs").glob("*.json")):
        r = json.loads(f.read_text(encoding="utf-8"))
        runs[r["stem"]] = r
    return runs


def sort_key(r: dict):
    return (r["batch"], ORDER[r["variant"]], len(r["knobs"]), r["knobs"], len(r["tags"]), r["tags"])


def fmt(x, nd=2, pct=False):
    if x is None:
        return "–"
    return f"{x:+.1f}%" if pct else f"{x:.{nd}f}"


class Evaluator:
    def __init__(self, out: Path, labels: str | None, args):
        self.out, self.args = out, args
        self.labels = Path(labels) if labels else None
        self._dets = {}
        self.gt = {}  # image name -> label rows, filled as images appear

    def dets(self, r: dict | None):
        if not r or r.get("status") != "ok" or not r.get("dets_file"):
            return None
        if r["stem"] not in self._dets:
            f = Path(r["dets_file"])
            loaded = C.load_dets(f if f.exists() else self.out / "dets" / f.name)
            self._dets[r["stem"]] = loaded
            if loaded and self.labels:
                for name, shape in loaded[1].items():
                    if name not in self.gt:
                        self.gt[name] = C.read_labels(self.labels, name, shape)
        d = self._dets[r["stem"]]
        return d[0] if d else None

    def agree(self, ref: dict | None, row: dict):
        a, b = self.dets(ref), self.dets(row)
        return C.agreement(a, b) if a is not None and b is not None else None

    def vs_labels(self, row: dict):
        d = self.dets(row)
        if d is None or not self.labels:
            return None
        return C.agreement({n: self.gt[n] for n in d}, d)


def with_tags(name: str, tags) -> str:
    n = C.parse_name(name)
    return str(C.Name(n.variant, n.knobs, tuple(tags)))


def pick_parent(r: dict, runs: dict) -> str | None:
    """A tagged run compares with the previous rung under the same tag when that was run too (a whole ladder under
    GAP_MS or TAG), else with its own untagged self (one contended run, say)."""
    n = C.parse_name(r["name"])
    if n.tags:
        up = C.parent_name(str(C.Name(n.variant, n.knobs)))
        if up and f"{with_tags(up, n.tags)}_b{r['batch']}" in runs:
            return with_tags(up, n.tags)
    return r.get("parent")


def build_rows(runs: dict, ev: Evaluator, args) -> list[dict]:
    rows = []
    for r in sorted(runs.values(), key=sort_key):
        b = r["batch"]
        parent_name = pick_parent(r, runs)
        parent = runs.get(f"{parent_name}_b{b}") if parent_name else None
        base = runs.get(f"{with_tags('baseline', r['tags'])}_b{b}") or runs.get(f"baseline_b{b}")
        lat = r.get("latency_ms") or {}
        plat = (parent or {}).get("latency_ms") or {}
        same_tag = bool(r["tags"]) and bool(parent_name) and C.parse_name(parent_name).tags == tuple(r["tags"])
        row = {
            "r": r,
            "parent": parent_name,
            "adds": C.describe(with_tags(r["name"], ())) if same_tag else r["adds"],
            "base": base,
            "head_change": r["variant"] == "nmsfree" and not r["knobs"] and bool(parent_name)
            and C.parse_name(parent_name).variant == "tuned",
            "p50": lat.get("p50"),
            "p95": lat.get("p95"),
            "p99": lat.get("p99"),
            "ips": r.get("img_per_s"),
            "cold": round(sum(v for v in (r.get("cold_start") or {}).values() if isinstance(v, (int, float))), 1) or None,
            "stages": r.get("stages_ms_per_image") or {},
            "d_p50": (lat["p50"] - plat["p50"]) / plat["p50"] * 100 if lat.get("p50") and plat.get("p50") else None,
            "vs_parent": ev.agree(parent, r) if parent else None,
            "vs_base": ev.agree(base, r) if base and base is not r else None,
            "gt": ev.vs_labels(r),
        }
        row["notes"] = notes(row, args)
        rows.append(row)
    return rows


def passes(a: dict | None, args) -> bool | None:
    if not a or a["n_ref"] == 0:  # nothing to agree with: recall of 1.0 would be vacuous, so the bar is unknown
        return None
    return a["recall"] >= args.recall_bar and (a["miou"] or 0) >= args.miou_bar


def notes(row: dict, args) -> str:
    r = row["r"]
    if r["status"] != "ok":
        log = f"logs/{r['stem']}.log"
        return f"**{r['status']}**: {r.get('reason', '')[:160]} ({log})"
    out = []
    if row["d_p50"] is not None:
        if row["d_p50"] > 0:
            out.append("slower than parent")
        elif -row["d_p50"] < args.min_gain:
            out.append(f"gain < {args.min_gain:g}%: drop")
    for key, who in (("vs_parent", "parent"), ("vs_base", "baseline")):
        if row[key] and row[key]["n_ref"] == 0:
            out.append(f"{who} found no boxes: agreement undefined (model does not match these images?)")
            break
    if row["head_change"]:
        out.append("different head: judge on labels")
    elif passes(row["vs_parent"], args) is False:
        out.append("changes detections")
    s = row["stages"]
    if s.get("preprocess") and s.get("inference") and s["preprocess"] >= s["inference"]:
        out.append("pre-processing bound")
    return "; ".join(out)


def ra(a: dict | None) -> str:
    return f"{a['recall']:.3f} / {fmt(a['miou'], 3)}" if a else "–"


def gt_cell(a: dict | None) -> str:
    return f"{a['precision']:.3f} / {a['recall']:.3f} / {fmt(a['miou'], 3)}" if a else "–"


def accuracy_ok(row: dict, base_row: dict | None, args) -> bool | None:
    """Ladder rows on the NMS-free head are judged on labels; the rest on agreement with baseline."""
    if "nmsfree" in C.chain(row["r"]["variant"]):
        g, bg = row["gt"], (base_row or {}).get("gt")
        if not g or not bg:
            return None
        return g["recall"] >= bg["recall"] - args.gt_tol and (g["miou"] or 0) >= (bg["miou"] or 0) - args.gt_tol
    return True if row["r"]["variant"] == "baseline" else passes(row["vs_base"], args)


def ladder_decision(ladder: list[dict], args, label: str) -> list[str]:
    base = next((x for x in ladder if x["r"]["variant"] == "baseline"), None)
    lines = []
    judged = [(x, accuracy_ok(x, base, args)) for x in ladder]
    unknown = [x["r"]["name"] for x, ok in judged if ok is None]
    passing = [x for x, ok in judged if ok]
    if passing:
        fastest = min(passing, key=lambda x: x["p95"])
        lines.append(f"- Fastest variant{label} that passes the accuracy bar: **{fastest['r']['name']}**, p95 {fastest['p95']:.2f} ms.")
    if args.target_p95:
        meets = [x for x in passing if x["p95"] <= args.target_p95]
        if meets:
            pick = min(meets, key=lambda x: (len(C.chain(x["r"]["variant"])), x["p95"]))
            lines.append(
                f"- Simplest variant{label} meeting p95 ≤ {args.target_p95:g} ms: **{pick['r']['name']}** "
                f"({len(C.chain(pick['r']['variant'])) - 1} change(s) from baseline, p95 {pick['p95']:.2f} ms)."
            )
        else:
            lines.append(f"- No passing variant{label} meets p95 ≤ {args.target_p95:g} ms at this batch size.")
    if unknown:
        lines.append(
            f"- Accuracy unknown for {', '.join(unknown)}: NMS-free rows need --labels (the head differs, so agreement "
            "with baseline is not a verdict); others need a detection dump (runs without --no-accuracy) and a baseline "
            "that found boxes."
        )
    return lines


def decision(rows: list[dict], args) -> list[str]:
    """Decision lines for the untagged ladder, and for each tag a whole ladder was run under (it has a baseline)."""
    groups = {}
    for x in rows:
        if x["r"]["status"] == "ok" and not x["r"]["knobs"]:
            groups.setdefault(tuple(x["r"]["tags"]), []).append(x)
    lines = []
    for tags, ladder in sorted(groups.items()):
        if tags and not any(x["r"]["variant"] == "baseline" for x in ladder):
            continue  # one-off tagged runs (e.g. a contended re-run) are read off their own row
        lines += ladder_decision(ladder, args, f" under @{'@'.join(tags)}" if tags else "")
    keep = [
        x["r"]["name"]
        for x in rows
        if x["r"]["knobs"] and not x["r"]["tags"] and x["r"]["status"] == "ok" and x["d_p50"] is not None
        and -x["d_p50"] >= args.min_gain and passes(x["vs_parent"], args) is not False
    ]
    if keep:
        lines.append(f"- ROCm knobs worth keeping (≥ {args.min_gain:g}% faster than their rung, same boxes): {', '.join(keep)}.")
    return lines


def state_key(r: dict) -> str:
    s = r.get("system") or {}
    card = next((v for k, v in s.items() if k.startswith("card")), {}) or {}
    return f"perf={card.get('perf_level')}, profile={card.get('power_profile')}, cpu={s.get('cpu_governor')}, platform={s.get('platform_profile')}"


def write_report(out: Path, runs: dict, rows: list[dict], ev: Evaluator, args) -> Path:
    ok = [r for r in runs.values() if r["status"] == "ok"]
    first = next((r for r in ok if r.get("versions", {}).get("torch")), ok[0] if ok else {})
    dev = first.get("device") or {}
    v = first.get("versions") or {}
    md = [
        "# YOLO26 ROCm latency report",
        "",
        f"Generated {datetime.now():%Y-%m-%d %H:%M} from `{out}`. Device: {dev.get('name', '?')} ({dev.get('arch', '?')}); "
        f"torch {v.get('torch', '?')}, HIP {v.get('hip', '?')}, Ultralytics {v.get('ultralytics', '?')}.",
        f"Latency is per batch, from decoded frames in memory to boxes on the CPU. Bars: recall ≥ {args.recall_bar}, "
        f"mIoU ≥ {args.miou_bar}, worthwhile gain ≥ {args.min_gain:g}%." + ("" if ev.labels else " No labels given."),
        "",
    ]
    states = {}
    for r in ok:
        states.setdefault(state_key(r), []).append(r["stem"])
    if len(states) > 1:
        md += ["> **Power state changed between runs**; compare only rows that share one:", ">"]
        md += [f"> - {k}: {', '.join(sorted(s))}" for k, s in states.items()]
        md.append("")
    elif states:
        md += [f"Power state for every run: {next(iter(states))}.", ""]

    for b in sorted({r["batch"] for r in runs.values()}):
        br = [x for x in rows if x["r"]["batch"] == b]
        md += [
            f"## Batch {b}",
            "",
            "| Run | Adds | vs | p50 ms | p95 ms | img/s | Δp50 | Cold s | Pre / Inf / Post ms/img | vs parent R / mIoU | vs baseline R / mIoU | Labels P / R / mIoU | Notes |",
            "|---|---|---|--:|--:|--:|--:|--:|---|---|---|---|---|",
        ]
        for x in br:
            r, s = x["r"], x["stages"]
            st = " / ".join(fmt(s.get(k)) for k in ("preprocess", "inference", "postprocess")) if s else "–"
            md.append(
                f"| `{r['name']}` | {x['adds']} | {x['parent'] or '–'} | {fmt(x['p50'])} | {fmt(x['p95'])} | "
                f"{fmt(x['ips'], 1)} | {fmt(x['d_p50'], pct=True)} | {fmt(x['cold'], 1)} | {st} | {ra(x['vs_parent'])} | "
                f"{ra(x['vs_base'])} | {gt_cell(x['gt'])} | {x['notes']} |"
            )
        md += ["", *decision(br, args), ""]

    pre = sorted((out / "preproc").glob("preproc_b*.json"))
    if pre:
        md += ["## Pre-processing", "", "| Batch | Frames | cpu p50 | cpu_pinned p50 | gpu p50 | GPU vs cv2 max diff | Verdict |", "|--:|---|--:|--:|--:|--:|---|"]
        for f in pre:
            p = json.loads(f.read_text(encoding="utf-8"))
            c, pn, g = (p["paths"][k]["p50"] for k in ("cpu", "cpu_pinned", "gpu"))
            verdict = "GPU letterbox pays" if g < 0.7 * c else "keep the CPU letterbox"
            md.append(
                f"| {p['batch']} | {p['frames']}/{p['of_total']} at {p['resolution'][1]}x{p['resolution'][0]} | {c:.3f} | "
                f"{pn:.3f} | {g:.3f} | {p['gpu_vs_cpu_max_abs_diff']} | {verdict} |"
            )
        md.append("")

    prof = [x for x in rows if (x["r"].get("profile") or {}).get("kernels_per_batch")]
    if prof:
        md += [
            "## Where the time goes (torch.profiler)",
            "",
            "Low GPU busy share means launch and CPU overhead dominate: HIP graphs or MIGraphX help most. High share means "
            "the kernels themselves dominate: tuning, FP16 and INT8 help most.",
            "",
            "| Run | Kernels/batch | GPU busy % | Kernel ms/batch | Copy ms/batch | Top kernel |",
            "|---|--:|--:|--:|--:|---|",
        ]
        for x in prof:
            p = x["r"]["profile"]
            top = p["top_kernels"][0] if p.get("top_kernels") else {}
            md.append(
                f"| `{x['r']['stem']}` | {p['kernels_per_batch']} | {fmt(p.get('gpu_busy_pct'), 1)} | {p['kernel_ms_per_batch']} | "
                f"{p['copy_ms_per_batch']} | `{top.get('name', '')[:60]}` {top.get('ms_per_batch', '')} ms |"
            )
        md.append("")

    path = out / "report.md"
    path.write_text("\n".join(md), encoding="utf-8")
    return path


def write_csv(out: Path, rows: list[dict]) -> Path:
    path = out / "summary.csv"
    cols = [
        "stem", "name", "variant", "knobs", "tags", "batch", "status", "reason", "p50", "p95", "p99", "img_per_s",
        "cold_s", "pre_ms_img", "inf_ms_img", "post_ms_img", "parent", "d_p50_pct", "recall_vs_parent",
        "miou_vs_parent", "recall_vs_baseline", "miou_vs_baseline", "gt_precision", "gt_recall", "gt_miou",
        "kernels_per_batch", "gpu_busy_pct", "gap_ms", "perf_level_etc",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for x in rows:
            r, s = x["r"], x["stages"]
            g = lambda a, k: a.get(k) if a else None  # noqa: E731
            p = r.get("profile") or {}
            w.writerow([
                r["stem"], r["name"], r["variant"], "+".join(r["knobs"]), "@".join(r["tags"]), r["batch"], r["status"],
                r.get("reason", ""), x["p50"], x["p95"], x["p99"], x["ips"], x["cold"], s.get("preprocess"),
                s.get("inference"), s.get("postprocess"), x["parent"],
                round(x["d_p50"], 2) if x["d_p50"] is not None else None,
                g(x["vs_parent"], "recall"), g(x["vs_parent"], "miou"), g(x["vs_base"], "recall"), g(x["vs_base"], "miou"),
                g(x["gt"], "precision"), g(x["gt"], "recall"), g(x["gt"], "miou"),
                p.get("kernels_per_batch"), p.get("gpu_busy_pct"), r.get("gap_ms"), state_key(r),
            ])
    return path


def compare(a_dir: Path, b_dir: Path, drift: float) -> int:
    a, b = load_runs(a_dir), load_runs(b_dir)
    md = [f"# Run-to-run drift: `{a_dir}` vs `{b_dir}`", "", "| Run | p50 A | p50 B | Drift | |", "|---|--:|--:|--:|---|"]
    bad = 0
    for stem in sorted(set(a) & set(b), key=lambda s: sort_key(a[s])):
        pa, pb = (a[stem].get("latency_ms") or {}).get("p50"), (b[stem].get("latency_ms") or {}).get("p50")
        if not pa or not pb:
            continue
        d = (pb - pa) / pa * 100
        flag = "**noisy**" if abs(d) > drift else ""
        bad += bool(flag)
        md.append(f"| `{stem}` | {pa:.2f} | {pb:.2f} | {d:+.1f}% | {flag} |")
    md += ["", f"{bad} run(s) moved more than {drift:g}%: the machine was not quiet, or the power state differed." if bad else f"All runs within {drift:g}%."]
    path = b_dir / "compare.md"
    path.write_text("\n".join(md), encoding="utf-8")
    print("\n".join(md))
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default="results")
    p.add_argument("--labels", default="", help="YOLO .txt labels for the test images")
    p.add_argument("--target-p95", type=float, default=0, help="p95 ms per batch the line needs")
    p.add_argument("--min-gain", type=float, default=5, help="%% p50 gain below which a step is not worth it")
    p.add_argument("--recall-bar", type=float, default=0.98)
    p.add_argument("--miou-bar", type=float, default=0.95)
    p.add_argument("--gt-tol", type=float, default=0.02, help="allowed drop vs baseline on label recall/mIoU")
    p.add_argument("--compare", default="", help="second results folder: report p50 drift instead")
    p.add_argument("--drift", type=float, default=5)
    args = p.parse_args()

    out = Path(args.out)
    if args.compare:
        return compare(out, Path(args.compare), args.drift)
    runs = load_runs(out)
    if not runs:
        print(f"no runs in {out / 'runs'}")
        return 1
    ev = Evaluator(out, args.labels or None, args)
    rows = build_rows(runs, ev, args)
    md = write_report(out, runs, rows, ev, args)
    csv_path = write_csv(out, rows)
    print(f"wrote {md} and {csv_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
