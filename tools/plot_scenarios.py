#!/usr/bin/env python3
"""Render SolarHelm simulator CSVs into the docs/img/ scenario plots.

Usage:
    python3 tools/plot_scenarios.py [--csv-dir sim/out] [--out docs/img]
                                    [scenario ...]

Run `make scenarios` first (or tools/check_coverage.sh, which also does).
"""

import argparse
import csv
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

DEFAULT_SCENARIOS = [
    "DemoA_SolarSwing",
    "DemoB_SuddenSolarDrop",
    "DemoC_SolarRise",
    "DemoD_ReserveFloor",
    "CroatiaClearSummerDay",
    "CroatiaPassingClouds",
    "ShuntFailure",
]

MODE_NAMES = {0: "MANUAL", 1: "SOLAR", 2: "SOLAR+"}


def load(path):
    with open(path) as f:
        rows = list(csv.DictReader(f))
    cols = {}
    for key in rows[0]:
        cols[key] = [float(r[key]) for r in rows]
    return cols


def plot_scenario(name, csv_dir, out_dir):
    path = os.path.join(csv_dir, f"{name}.csv")
    if not os.path.exists(path):
        print(f"skip {name}: {path} not found (run `make scenarios`)")
        return False
    d = load(path)
    t_h = [ms / 1000.0 / 3600.0 for ms in d["timestamp_ms"]]

    fig, axes = plt.subplots(4, 1, figsize=(11, 11), sharex=True)
    fig.suptitle(f"SolarHelm — {name}", fontsize=14, fontweight="bold")

    ax = axes[0]
    ax.plot(t_h, d["true_pv_available_w"], color="#f5a623",
            label="PV available")
    ax.plot(t_h, d["true_pv_used_w"], color="#b8860b", ls="--",
            label="PV used")
    ax.plot(t_h, d["true_motor_w"], color="#1f77b4", label="Motor")
    ax.plot(t_h, d["true_hotel_w"], color="#7f7f7f", label="Hotel")
    ax.set_ylabel("Power [W]")
    ax.legend(loc="upper right", ncol=4, fontsize=8)
    ax.grid(alpha=0.3)

    ax = axes[1]
    ax.plot(t_h, d["true_battery_w"], color="#2ca02c")
    ax.axhline(0, color="black", lw=0.8)
    ax.set_ylabel("Battery power [W]\n(+charge / −discharge)")
    ax.grid(alpha=0.3)

    ax = axes[2]
    ax.plot(t_h, d["true_soc_pct"], color="#d62728", label="SOC")
    ax.plot(t_h, d["reserve_soc_pct"], color="#d62728", ls=":",
            label="reserve")
    ax.set_ylabel("SOC [%]")
    ax.legend(loc="upper right", fontsize=8)
    ax.grid(alpha=0.3)

    ax = axes[3]
    ax.plot(t_h, d["true_speed_kmh"], color="#9467bd", label="Speed")
    ax2 = ax.twinx()
    ax2.plot(t_h, d["motor_command_pct"], color="#8c564b", alpha=0.6,
             label="Motor cmd")
    ax2.set_ylabel("Motor command [%]")
    ax.set_ylabel("Speed [km/h]")
    ax.set_xlabel("Time [h]")
    lines = ax.get_lines() + ax2.get_lines()
    ax.legend(lines, [ln.get_label() for ln in lines], loc="upper right",
              fontsize=8)
    ax.grid(alpha=0.3)

    # Shade non-automatic (MANUAL) intervals.
    auto = d["auto_active"]
    start = None
    for i, a in enumerate(auto + [1.0]):
        if a < 0.5 and start is None:
            start = t_h[min(i, len(t_h) - 1)]
        elif a >= 0.5 and start is not None:
            for axx in axes:
                axx.axvspan(start, t_h[min(i, len(t_h) - 1)], color="red",
                            alpha=0.08)
            start = None
    if start is not None:
        for axx in axes:
            axx.axvspan(start, t_h[-1], color="red", alpha=0.08,
                        label="MANUAL")

    fig.tight_layout()
    out = os.path.join(out_dir, f"{name}.png")
    fig.savefig(out, dpi=110)
    plt.close(fig)
    print(f"wrote {out}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv-dir", default="sim/out")
    ap.add_argument("--out", default="docs/img")
    ap.add_argument("scenarios", nargs="*", default=DEFAULT_SCENARIOS)
    args = ap.parse_args()
    scenarios = args.scenarios or DEFAULT_SCENARIOS
    os.makedirs(args.out, exist_ok=True)
    ok = True
    for name in scenarios:
        ok = plot_scenario(name, args.csv_dir, args.out) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
