#!/usr/bin/env bash
# Show or set the power state that moves latency on the Strix Halo box: the iGPU performance level and power
# profile, the CPU governor (letterbox and post-processing run on the CPU) and the ACPI platform profile.
#
#   ./gpu_perf.sh status
#   sudo ./gpu_perf.sh high      # GPU clocks held high, CPU governor performance, platform profile performance
#   sudo ./gpu_perf.sh compute   # GPU on the COMPUTE power profile instead of fixed-high clocks
#   sudo ./gpu_perf.sh auto      # back to what was there before the first change
#
# Every benchmark result records this state, and report.py warns when rows were measured under different states.
set -uo pipefail

SAVE=/var/tmp/yolo_rocm_bench_power.saved

amd_cards() {
    for dev in /sys/class/drm/card*/device; do
        local card; card=$(basename "$(dirname "$dev")")
        [[ "$card" =~ ^card[0-9]+$ ]] || continue
        [ "$(cat "$dev/vendor" 2>/dev/null)" = 0x1002 ] && echo "$dev"
    done
}

put() {  # put <value> <file>: write if the file exists, report failures without stopping
    [ -e "$2" ] || return 0
    echo "$1" >"$2" 2>/dev/null || echo "  could not write '$1' to $2"
}

status() {
    for dev in $(amd_cards); do
        echo "$(basename "$(dirname "$dev")"): perf_level=$(cat "$dev/power_dpm_force_performance_level")"
        echo "  power profile: $(grep '\*' "$dev/pp_power_profile_mode" 2>/dev/null | head -1 | xargs)"
        echo "  gfx clock now: $(grep '\*' "$dev/pp_dpm_sclk" 2>/dev/null | xargs)"
    done
    echo "cpu governor: $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null)" \
         " epp: $(cat /sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference 2>/dev/null)"
    echo "platform profile: $(cat /sys/firmware/acpi/platform_profile 2>/dev/null || echo n/a)" \
         " (choices: $(cat /sys/firmware/acpi/platform_profile_choices 2>/dev/null || echo n/a))"
}

save_once() {
    [ -e "$SAVE" ] && return
    {
        for dev in $(amd_cards); do
            echo "gpu $dev $(cat "$dev/power_dpm_force_performance_level")"
        done
        echo "cpu $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null)"
        echo "platform $(cat /sys/firmware/acpi/platform_profile 2>/dev/null)"
    } >"$SAVE"
}

need_root() { [ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }; }

case "${1:-status}" in
    status) status ;;
    high)
        need_root; save_once
        for dev in $(amd_cards); do put high "$dev/power_dpm_force_performance_level"; done
        for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do put performance "$g"; done
        grep -qw performance /sys/firmware/acpi/platform_profile_choices 2>/dev/null && put performance /sys/firmware/acpi/platform_profile
        status ;;
    compute)
        need_root; save_once
        for dev in $(amd_cards); do
            idx=$(grep -m1 COMPUTE "$dev/pp_power_profile_mode" | awk '{print $1}')
            [ -n "$idx" ] || { echo "no COMPUTE profile on $dev"; continue; }
            put manual "$dev/power_dpm_force_performance_level"
            put "$idx" "$dev/pp_power_profile_mode"
        done
        status ;;
    auto)
        need_root
        for dev in $(amd_cards); do  # the profile can only be written in manual mode
            put manual "$dev/power_dpm_force_performance_level"
            put 0 "$dev/pp_power_profile_mode"
            put auto "$dev/power_dpm_force_performance_level"
        done
        if [ -e "$SAVE" ]; then
            cpu=$(awk '$1=="cpu"{print $2}' "$SAVE"); plat=$(awk '$1=="platform"{print $2}' "$SAVE")
            [ -n "$cpu" ] && for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do put "$cpu" "$g"; done
            [ -n "$plat" ] && put "$plat" /sys/firmware/acpi/platform_profile
            rm -f "$SAVE"
        fi
        status ;;
    *) echo "usage: $0 status|high|compute|auto"; exit 1 ;;
esac
