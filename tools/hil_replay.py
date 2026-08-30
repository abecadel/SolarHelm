#!/usr/bin/env python3
"""HIL replay: turn simulator scenario CSVs into real sensor byte streams.

Bench gates A3/A4/A7 (docs/HARDWARE_TEST_PLAN.md) need a SmartShunt and a
GNSS receiver before either exists on the bench. This tool replays a
simulator scenario (sim/out/*.csv, regenerable with `make scenarios`) — or
a synthesized steady cruise — as the exact wire formats the firmware's
drivers parse:

  shunt  VE.Direct text blocks (V/I/P/SOC, mod-256 checksum, protocol
         v3.34) at ~1 Hz  -> ESP32 Serial1 (19200 8N1, 3.3 V!)
  gps    NMEA 0183 RMC+VTG at 5 Hz plus GGA at 1 Hz (XOR checksum,
         Doppler SOG from the CSV speed) -> ESP32 Serial2 (115200 8N1)
  mppt   VE.Direct MPPT blocks (PPV/CS) at ~1 Hz, for a future solar UART

One instance drives one UART: run one per USB-serial dongle, e.g.

  tools/hil_replay.py sim/out/CroatiaClearSummerDay.csv \
      --stream shunt --port /dev/ttyUSB0
  tools/hil_replay.py sim/out/CroatiaClearSummerDay.csv \
      --stream gps --port /dev/ttyUSB1

Without --port, frames go to stdout (add --hex to inspect the framing
bytes). --rate scales playback speed; --max-seconds bounds a run.
--selftest re-validates every generated frame with independent checksum
and round-trip checks — it is this tool's CI gate (tools/*.py sit outside
the coverage gate by design).

pyserial is required only for --port; everything else is stdlib.
"""

import argparse
import math
import sys
import time

KNOTS_PER_KMH = 1.0 / 1.852

# Columns consumed from the scenario CSV (sim/out/*.csv).
CSV_FIELDS = {
    "timestamp_ms": int,
    "battery_voltage_v": float,
    "battery_current_a": float,
    "battery_power_w": float,
    "battery_soc_pct": float,
    "solar_power_w": float,
    "speed_kmh": float,
    "latitude_deg": float,
    "longitude_deg": float,
}


# --- frame builders -------------------------------------------------------

def vedirect_block(records):
    """Frame label/value pairs as one VE.Direct text block.

    Each record is b"\r\n<label>\t<value>"; the block ends with
    b"\r\nChecksum\t<byte>" where <byte> makes the modulo-256 sum of every
    byte in the block zero (VE.Direct protocol v3.34).
    """
    body = b""
    for label, value in records:
        body += b"\r\n" + label.encode() + b"\t" + str(value).encode()
    body += b"\r\nChecksum\t"
    check = (256 - sum(body)) % 256
    return body + bytes([check])


def shunt_block(row):
    """SmartShunt block: V [mV], I [mA], P [W], SOC [promille]."""
    return vedirect_block([
        ("V", int(round(row["battery_voltage_v"] * 1000))),
        ("I", int(round(row["battery_current_a"] * 1000))),
        ("P", int(round(row["battery_power_w"]))),
        ("SOC", int(round(row["battery_soc_pct"] * 10))),
    ])


def mppt_block(row):
    """MPPT block: PPV [W] plus charge state CS (0 off, 3 bulk)."""
    ppv = int(round(row["solar_power_w"]))
    return vedirect_block([("PPV", ppv), ("CS", 3 if ppv > 0 else 0)])


def nmea_sentence(body):
    """Wrap an address+fields body as $<body>*<XOR-checksum>\r\n."""
    check = 0
    for b in body.encode():
        check ^= b
    return f"${body}*{check:02X}\r\n".encode()


def nmea_latlon(deg, positive, negative):
    """Decimal degrees -> (ddmm.mmmm, hemisphere)."""
    hemi = positive if deg >= 0 else negative
    mag = abs(deg)
    d = int(mag)
    minutes = (mag - d) * 60.0
    width = 4 if positive == "N" else 5  # lon uses 3 degree digits
    return f"{d * 100 + minutes:0{width + 5}.4f}", hemi


def nmea_time(t_s):
    """Seconds-into-run -> hhmmss.ss (wraps at 24 h)."""
    t = t_s % 86400.0
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}{int(m):02d}{s:05.2f}"


def has_fix(row):
    lat, lon = row["latitude_deg"], row["longitude_deg"]
    return not (lat == 0.0 and lon == 0.0)  # firmware's no-fix sentinel


def rmc_sentence(row, t_s):
    """RMC: time, validity, position, Doppler SOG [kn], COG, date."""
    sog_kn = row["speed_kmh"] * KNOTS_PER_KMH
    if not has_fix(row):
        body = f"GPRMC,{nmea_time(t_s)},V,,,,,,,010126,,,N"
    else:
        lat, ns = nmea_latlon(row["latitude_deg"], "N", "S")
        lon, ew = nmea_latlon(row["longitude_deg"], "E", "W")
        body = (f"GPRMC,{nmea_time(t_s)},A,{lat},{ns},{lon},{ew},"
                f"{sog_kn:.2f},90.0,010126,,,A")
    return nmea_sentence(body)


def vtg_sentence(row):
    """VTG: COG true/magnetic, SOG in knots and km/h."""
    if not has_fix(row):
        body = "GPVTG,,T,,M,,N,,K,N"
    else:
        sog_kn = row["speed_kmh"] * KNOTS_PER_KMH
        body = (f"GPVTG,90.0,T,,M,{sog_kn:.2f},N,"
                f"{row['speed_kmh']:.2f},K,A")
    return nmea_sentence(body)


def gga_sentence(row, t_s):
    """GGA: fix quality + satellites in use (freshness/diagnostics)."""
    if not has_fix(row):
        body = f"GPGGA,{nmea_time(t_s)},,,,,0,00,,,M,,M,,"
    else:
        lat, ns = nmea_latlon(row["latitude_deg"], "N", "S")
        lon, ew = nmea_latlon(row["longitude_deg"], "E", "W")
        body = (f"GPGGA,{nmea_time(t_s)},{lat},{ns},{lon},{ew},"
                f"1,10,0.9,5.0,M,,M,,")
    return nmea_sentence(body)


# --- data sources ---------------------------------------------------------

def load_csv(path):
    """Load the scenario columns; rows sorted by timestamp."""
    with open(path, encoding="utf-8") as f:
        header = f.readline().strip().split(",")
        idx = {}
        for name in CSV_FIELDS:
            if name not in header:
                raise SystemExit(f"{path}: missing column {name}")
            idx[name] = header.index(name)
        rows = []
        for line in f:
            parts = line.strip().split(",")
            if len(parts) < len(header):
                continue
            rows.append({name: cast(parts[idx[name]])
                         for name, cast in CSV_FIELDS.items()})
    if not rows:
        raise SystemExit(f"{path}: no data rows")
    rows.sort(key=lambda r: r["timestamp_ms"])
    return rows


def synth_rows(seconds=3600):
    """Steady 5.4 km/h cruise off Split with a gentle solar swing."""
    rows = []
    for s in range(0, seconds, 2):
        sun = max(0.0, math.sin(math.pi * (s % 3600) / 3600.0)) * 420.0
        rows.append({
            "timestamp_ms": s * 1000,
            "battery_voltage_v": 25.6,
            "battery_current_a": round((sun - 480.0) / 25.6, 3),
            "battery_power_w": round(sun - 480.0, 1),
            "battery_soc_pct": 76.5,
            "solar_power_w": round(sun, 1),
            "speed_kmh": 5.4,
            "latitude_deg": 43.5081 + s * 1.35e-5,  # ~1.5 m/s northward
            "longitude_deg": 16.4402,
        })
    return rows


def row_at(rows, t_ms):
    """Latest row with timestamp <= t_ms (first row before that)."""
    lo, hi = 0, len(rows) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if rows[mid]["timestamp_ms"] <= t_ms:
            lo = mid
        else:
            hi = mid - 1
    return rows[lo]


# --- playback -------------------------------------------------------------

STREAMS = {
    # stream -> (frames per second, frame builder(row, t_s) -> bytes)
    "shunt": (1, lambda row, t_s: shunt_block(row)),
    "mppt": (1, lambda row, t_s: mppt_block(row)),
    "gps": (5, lambda row, t_s: rmc_sentence(row, t_s) + vtg_sentence(row)
            + (gga_sentence(row, t_s) if t_s == int(t_s) else b"")),
}


def open_sink(args):
    if args.port:
        try:
            import serial  # pyserial, needed only for hardware runs
        except ImportError:
            raise SystemExit("pyserial is required for --port "
                             "(pip install pyserial)")
        dev = serial.Serial(args.port, args.baud, timeout=1)
        return lambda data: dev.write(data)
    if args.hex:
        return lambda data: print(data.hex(" "))
    return lambda data: sys.stdout.buffer.write(data)


def replay(rows, args, sink, sleep=time.sleep):
    """Emit frames from rows[0] to the last row at the stream's rate."""
    hz, build = STREAMS[args.stream]
    t0_ms = rows[0]["timestamp_ms"]
    end_ms = rows[-1]["timestamp_ms"]
    if args.max_seconds is not None:
        end_ms = min(end_ms, t0_ms + int(args.max_seconds * 1000))
    step_ms = 1000 // hz
    frames = 0
    t_ms = t0_ms
    while t_ms <= end_ms:
        t_s = (t_ms - t0_ms) / 1000.0
        sink(build(row_at(rows, t_ms), t_s))
        frames += 1
        t_ms += step_ms
        sleep(step_ms / 1000.0 / args.rate)
    return frames


# --- selftest: independent validation of every generated frame ------------

def check_vedirect(block):
    """Independent VE.Direct check: sum % 256 == 0; return {label: value}."""
    assert sum(block) % 256 == 0, "VE.Direct checksum broken"
    records = {}
    for rec in block[:-1].split(b"\r\n"):  # strip checksum byte
        if not rec:
            continue
        label, _, value = rec.partition(b"\t")
        records[label.decode()] = value.decode()
    assert records.pop("Checksum", None) is not None
    for label in records:
        assert len(label) <= 8, f"label {label} over VE.Direct limit"
    return records


def check_nmea(sentence):
    """Independent NMEA check: XOR between $ and *; return field list."""
    text = sentence.decode()
    assert text.startswith("$") and text.endswith("\r\n")
    body, _, tail = text[1:-2].partition("*")
    check = 0
    for ch in body.encode():
        check ^= ch
    assert f"{check:02X}" == tail, f"NMEA checksum broken: {text!r}"
    assert len(text) - 2 <= 82, f"NMEA sentence over 82 chars: {text!r}"
    return body.split(",")


def parse_ddmm(value, hemi):
    """Independent ddmm.mmmm -> signed decimal degrees."""
    v = float(value)
    deg = int(v) // 100
    minutes = v - deg * 100
    out = deg + minutes / 60.0
    return -out if hemi in ("S", "W") else out


def selftest():
    edge_rows = [
        {"timestamp_ms": 0, "battery_voltage_v": 25.61,
         "battery_current_a": -3.2, "battery_power_w": -81.9,
         "battery_soc_pct": 76.5, "solar_power_w": 412.0,
         "speed_kmh": 5.42, "latitude_deg": 43.5081,
         "longitude_deg": 16.4402},
        {"timestamp_ms": 2000, "battery_voltage_v": 0.0,
         "battery_current_a": 0.0, "battery_power_w": 0.0,
         "battery_soc_pct": 0.0, "solar_power_w": 0.0,
         "speed_kmh": 0.0, "latitude_deg": 0.0, "longitude_deg": 0.0},
        {"timestamp_ms": 4000, "battery_voltage_v": 28.8,
         "battery_current_a": -45.5, "battery_power_w": -1310.4,
         "battery_soc_pct": 100.0, "solar_power_w": 900.0,
         "speed_kmh": 11.1, "latitude_deg": -33.8568,
         "longitude_deg": -151.2153},
    ]
    checked = 0

    def check_row(row, t_s):
        nonlocal checked
        # SmartShunt block round-trips V/I/P/SOC at wire resolution.
        rec = check_vedirect(shunt_block(row))
        assert int(rec["V"]) == int(round(row["battery_voltage_v"] * 1000))
        assert int(rec["I"]) == int(round(row["battery_current_a"] * 1000))
        assert int(rec["P"]) == int(round(row["battery_power_w"]))
        assert int(rec["SOC"]) == int(round(row["battery_soc_pct"] * 10))
        # MPPT block round-trips PPV; CS says bulk only when producing.
        rec = check_vedirect(mppt_block(row))
        assert int(rec["PPV"]) == int(round(row["solar_power_w"]))
        assert int(rec["CS"]) == (3 if int(rec["PPV"]) > 0 else 0)
        # NMEA: RMC/VTG/GGA checksums + position and SOG round-trips.
        rmc = check_nmea(rmc_sentence(row, t_s))
        vtg = check_nmea(vtg_sentence(row))
        gga = check_nmea(gga_sentence(row, t_s))
        assert rmc[0] == "GPRMC" and vtg[0] == "GPVTG" and gga[0] == "GPGGA"
        if has_fix(row):
            assert rmc[2] == "A" and gga[6] == "1"
            lat = parse_ddmm(rmc[3], rmc[4])
            lon = parse_ddmm(rmc[5], rmc[6])
            assert abs(lat - row["latitude_deg"]) < 1e-5, (lat, row)
            assert abs(lon - row["longitude_deg"]) < 1e-5, (lon, row)
            sog_kmh = float(rmc[7]) * 1.852
            assert abs(sog_kmh - row["speed_kmh"]) < 0.02
            assert abs(float(vtg[7]) - row["speed_kmh"]) < 0.005
        else:
            assert rmc[2] == "V" and rmc[3] == "" and gga[6] == "0"
            assert vtg[5] == ""
        checked += 3
    for row in edge_rows:
        check_row(row, row["timestamp_ms"] / 1000.0)

    # Replay pacing: a 1 Hz stream over 10 s emits 11 frames; 5 Hz gps
    # emits 51, all checksum-valid; GGA rides along once per second.
    for stream, expect in (("shunt", 11), ("gps", 51)):
        ns = argparse.Namespace(stream=stream, rate=1e9, max_seconds=10)
        frames = []
        n = replay(synth_rows(20), ns, frames.append, sleep=lambda s: None)
        assert n == expect, (stream, n)
        for data in frames:
            if stream == "shunt":
                check_vedirect(data)
            else:
                for line in data.splitlines(keepends=True):
                    check_nmea(line)
        checked += len(frames)

    # Every shipped scenario generates valid frames on all streams,
    # including GPSFailure's no-fix rows.
    import glob
    import os
    out_dir = os.path.join(os.path.dirname(__file__), "..", "sim", "out")
    scenarios = sorted(glob.glob(os.path.join(out_dir, "*.csv")))
    for path in scenarios:
        rows = load_csv(path)
        for row in rows[:: max(1, len(rows) // 50)]:
            check_row(row, row["timestamp_ms"] / 1000.0)
    print(f"selftest OK: {checked} frames validated "
          f"across {len(scenarios)} scenarios + edge cases")
    return 0


# --- entry point ----------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="?",
                    help="scenario CSV (sim/out/*.csv); omit for a "
                         "synthesized steady cruise")
    ap.add_argument("--stream", choices=sorted(STREAMS), default="shunt",
                    help="which sensor to impersonate (default: shunt)")
    ap.add_argument("--port", help="serial device (e.g. /dev/ttyUSB0); "
                                   "omit for stdout")
    ap.add_argument("--baud", type=int, default=None,
                    help="baud rate (default: 19200 for VE.Direct, "
                         "115200 for gps — matches the firmware)")
    ap.add_argument("--rate", type=float, default=1.0,
                    help="playback speed multiplier (default 1.0)")
    ap.add_argument("--max-seconds", type=float, default=None,
                    help="stop after this much scenario time")
    ap.add_argument("--hex", action="store_true",
                    help="print frames as hex instead of raw bytes")
    ap.add_argument("--selftest", action="store_true",
                    help="validate generated frames and exit")
    args = ap.parse_args(argv)
    if args.selftest:
        return selftest()
    if args.baud is None:
        args.baud = 115200 if args.stream == "gps" else 19200
    rows = load_csv(args.csv) if args.csv else synth_rows()
    frames = replay(rows, args, open_sink(args))
    print(f"\ndone: {frames} frames ({args.stream})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
