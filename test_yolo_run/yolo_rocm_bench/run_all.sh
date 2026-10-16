#!/usr/bin/env bash
# Run the whole ladder, the ROCm knobs, and the report, keeping going past failures. Each step logs to
# $OUT/logs/<step>.log and writes $OUT/runs/<name>_b<B>.json. Every setting below can be overridden from the
# environment, e.g.  MODEL=best.pt IMGSZ=800 ONLY="fp16 migraphx_ep" bash run_all.sh   (see README.md).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODEL=${MODEL:-best.pt}
IMAGES=${IMAGES:-data/test_images}
LABELS=${LABELS:-}
CALIB=${CALIB:-}
BATCHES=${BATCHES:-"1 8"}
IMGSZ=${IMGSZ:-800}
ITERS=${ITERS:-100}
WARMUP=${WARMUP:-10}
GAP_MS=${GAP_MS:-0}
TAG=${TAG:-}
ONLY=${ONLY:-}
KNOBS=${KNOBS-"tuned+hipblaslt tuned+tunableop tuned+nhwc nmsfree+nosdma compile+autotune migraphx_ep+exhaustive migraphx_ep+winograd migraphx_ep+mlirtune mgx_fp16+exhaustive"}
SKIP_TUNE=${SKIP_TUNE:-0}
TUNE_LEVEL=${TUNE_LEVEL:-3}
PROFILE=${PROFILE:-20}
CAMERA=${CAMERA:-}  # line camera WxH, e.g. 1256x1256: the pre-processing benchmark resizes images to it
TARGET_P95=${TARGET_P95:-0}
PY_TORCH=${PY_TORCH:-python}
PY_MIGX=${PY_MIGX:-$PY_TORCH}
OUT=${OUT:-results}
ART=${ART:-artifacts}
CACHE=${CACHE:-.cache}

mkdir -p "$OUT/logs"
FAILED=()

wanted() {  # wanted <ladder rung>: true when ONLY is empty or lists it
    [ -z "$ONLY" ] || [[ " $ONLY " == *" $1 "* ]]
}

wanted_knob() {  # knob runs only when ONLY is empty or lists the exact name, e.g. tuned+nhwc
    [ -z "$ONLY" ] || [[ " $ONLY " == *" $1 "* ]]
}

tune_list() {  # configs whose MIOpen perf DB must be tuned: `tuned` for the ladder, plus NHWC knob configs
    local v k list=()
    for v in tuned nmsfree hipgraph compile compile_graphs; do wanted "$v" && { list=(tuned); break; }; done
    for k in $KNOBS; do
        [[ "$k" == *nhwc* ]] && wanted_knob "$k" || continue
        [ "$("$PY_TORCH" "$HERE/common.py" uses-tuning "$k")" = 1 ] && list+=("${k%%@*}")
    done
    echo "${list[@]}"
}

needs_export() {
    local v k
    for v in migraphx_ep mgx_fp16 mgx_int8; do wanted "$v" && return 0; done
    for k in $KNOBS; do [[ "$k" == migraphx* || "$k" == mgx* ]] && wanted_knob "$k" && return 0; done
    return 1
}

step() {  # step <log name> <command...>
    local log="$OUT/logs/$1.log"; shift
    printf '[%s] %-34s ' "$(date +%T)" "$(basename "$log" .log)"
    "$@" >"$log" 2>&1
    local rc=$?
    if [ $rc -eq 0 ]; then
        grep -E 'p50|skipped|wrote|exists|OK:|tuning pass' "$log" | tail -1 | cut -c1-90
    else
        echo "FAILED (rc=$rc) -> $log"
        FAILED+=("$(basename "$log" .log)")
    fi
}

run_name() {  # run_name <name> <batch> [profile]: route a run to the right script and interpreter
    local name=$1 b=$2 prof=${3:-0} rt
    rt=$("$PY_TORCH" "$HERE/common.py" runtime "$name") || { echo "bad run name: $name"; FAILED+=("$name"); return; }
    local common=(--variant "$name" --model "$MODEL" --images "$IMAGES" --batch "$b" --imgsz "$IMGSZ"
                  --iters "$ITERS" --warmup "$WARMUP" --gap-ms "$GAP_MS" --out "$OUT" --artifacts "$ART")
    [ -n "$TAG" ] && common+=(--tag "$TAG")
    if [ "$rt" = migraphx ]; then
        step "${name}_b$b" "$PY_MIGX" "$HERE/bench_migraphx.py" "${common[@]}" --calib "$CALIB"
    else
        step "${name}_b$b" "$PY_TORCH" "$HERE/bench_ultralytics.py" "${common[@]}" --cache "$CACHE" --profile "$prof"
    fi
}

echo "== environment"
step env_torch "$PY_TORCH" "$HERE/env_check.py" --out "$OUT"
[ "$PY_MIGX" != "$PY_TORCH" ] && step env_migraphx "$PY_MIGX" "$HERE/env_check.py" --out "$OUT" --migraphx-only

echo "== ladder: before MIOpen tuning (empty perf DB every run)"
for v in baseline fp16 static; do
    for b in $BATCHES; do wanted "$v" && run_name "$v" "$b" "$PROFILE"; done
done

echo "== MIOpen tuning pass (MIOPEN_FIND_ENFORCE=$TUNE_LEVEL)"
TUNE=$(tune_list)
if [ "$SKIP_TUNE" = 1 ]; then
    echo "   skipped (SKIP_TUNE=1); reusing $CACHE/miopen-db"
elif [ -z "$TUNE" ]; then
    echo "   nothing selected needs it"
else
    for t in $TUNE; do
        for b in $BATCHES; do
            step "tune_${t}_b$b" "$PY_TORCH" "$HERE/bench_ultralytics.py" --variant "$t" --tune --tune-level "$TUNE_LEVEL" \
                --model "$MODEL" --images "$IMAGES" --batch "$b" --imgsz "$IMGSZ" --warmup "$WARMUP" --out "$OUT" --cache "$CACHE"
        done
    done
fi

echo "== ladder: tuned and after"
for v in tuned nmsfree hipgraph compile compile_graphs; do
    for b in $BATCHES; do wanted "$v" && run_name "$v" "$b" "$PROFILE"; done
done

echo "== pre-processing micro-benchmark"
if [ -z "$ONLY" ] || [[ " $ONLY " == *" preproc "* ]]; then
    for b in $BATCHES; do
        step "preproc_b$b" "$PY_TORCH" "$HERE/bench_preproc.py" --images "$IMAGES" --batch "$b" --imgsz "$IMGSZ" \
            --iters "$ITERS" --warmup "$WARMUP" --out "$OUT" ${CAMERA:+--resolution "$CAMERA"}
    done
fi

echo "== ONNX export (hand-off to MIGraphX)"
if needs_export; then
    step export "$PY_TORCH" "$HERE/export_onnx.py" --model "$MODEL" --batch $BATCHES --imgsz "$IMGSZ" --out "$ART"
fi

echo "== MIGraphX"
for v in migraphx_ep mgx_fp16 mgx_int8; do
    for b in $BATCHES; do wanted "$v" && run_name "$v" "$b"; done
done

echo "== ROCm knobs (each compared with its rung)"
for k in $KNOBS; do
    for b in $BATCHES; do
        wanted_knob "$k" && run_name "$k" "$b"
    done
done

echo "== report"
report_args=(--out "$OUT" --target-p95 "$TARGET_P95")
[ -n "$LABELS" ] && report_args+=(--labels "$LABELS")
step report "$PY_TORCH" "$HERE/report.py" "${report_args[@]}"

echo
if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Done with ${#FAILED[@]} failed step(s): ${FAILED[*]}"
    echo "Each one's log is in $OUT/logs/; the report lists the reasons."
else
    echo "Done. Read $OUT/report.md"
fi
