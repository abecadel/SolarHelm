# SolarHelm Wiring Guide (initial — bench/prototype)

> **Read docs/SAFETY.md first.** This document describes the *topology*.
> Fuse ratings, cable cross-sections and contactor sizing MUST be
> calculated from the actual measured currents, cable lengths and
> installation of *your* build — deliberately no blanket numbers are given
> for the high-current path here. ABYC/ISO 10133 practice: every
> unprotected positive conductor as short as physically possible.

## High-current path (conceptual)

```
  PV array ──► MPPT ─────────────┐
                                 │
 (+) Battery ── main fuse ── service disconnect ──┬── MPPT battery (+)
      │        (class T/MEGA,   (battery switch)  ├── contactor ── motor controller B+ ── motor
      │         at the post)                      └── DC/DC 24→12 V ── hotel loads/fuse block
 (−) Battery ── SmartShunt(−) ──┬─────────────────┴── common negative bus
                                └── every single load's return passes
                                    through the shunt, or SOC lies
```

Rules:
- **Main fuse first**: directly at the battery positive post, before
  anything else, sized above max continuous draw and below the cable's
  ampacity — calculate, don't guess.
- **SmartShunt in the negative lead**, battery side of *everything*
  (including the MPPT and DC/DC returns). Any load bypassing the shunt
  corrupts SOC and battery-power measurement — SolarHelm's control input.
- **Contactor/enable**: the motor controller's supply (or its enable loop,
  per its manual) goes through the kill-switch-driven contactor. The kill
  switch does not pass through SolarHelm.
- MPPT PV-side and battery-side both fused per its manual; PV connectors
  properly rated (MC4), panels in series within the MPPT's Voc limit
  **at cold temperature** (Voc rises when cold — check the datasheet
  coefficient).

## Low-voltage control wiring

```
                 ┌────────────────────────────────────────────┐
                 │              SolarHelm (ESP32-S3)          │
 24 V bus ──► isolated DC/DC 24→5 V ──► 5 V rail              │
                 │                                            │
 SmartShunt VE.Direct ──► level care! VE.Direct is 3.3 V ──► UART1 RX/TX
 GNSS module        ────────────────────────────────────► UART2 (3.3 V)
 MPPT RS485 A/B     ──► RS485 transceiver (3.3 V) ──────► UART0/other
 GP8403 DAC module  ◄──── I2C (SDA/SCL, 3.3 V) ───────────┤
                 │                                            │
 MANUAL/AUTO switch ─► GPIO (pull-up, switch to GND) ─────┤
 kill-switch sense  ─► GPIO via optocoupler (sense only) ──┤
 AUTO-assert GPIO   ─► heartbeat ► monostable ► relay coil ┤
 status LED + buzzer ◄────────────────────────────────────┘
                 └────────────────────────────────────────────┘

 GP8403 OUT0 ──► hardware clamp (divider + zener) ──► relay NO ┐
 Manual throttle pot (controller's 5 V, per its manual) ── NC ─┼──► motor
 relay common ─────────────────────────────────────────────────┘    controller
                                                                    throttle in
```

Notes:
- **VE.Direct is 3.3 V logic** — connect TX/RX directly to ESP32 UART pins,
  never through a 5 V level shifter toward the port. Pin 1 GND, 2 RX, 3 TX,
  4 power (leave unused). Read-only use: connect SmartShunt TX → ESP32 RX
  only, plus GND.
- **Grounding**: single-point control ground to the main negative bus at the
  shunt's load side; the ESP32 supply is an *isolated* DC/DC so control
  ground can join at exactly one point without loops.
- The Kelly-class throttle input expects 0–5 V; the GP8403 in 0–5 V mode
  matches. Calibrate the controller's throttle-effective range so the
  hardware clamp ceiling maps below the controller's max (headroom for the
  clamp to actually bound output).
- The manual throttle keeps using the motor controller's own 5 V sensor
  supply, so it works with SolarHelm completely dead.
- Every cable entering the enclosure through a gland; the enclosure at
  IP65 for on-deck mounting.

## Bench prototype (BOM A) wiring

For Milestone 2 nothing high-current exists: ESP32 + GP8403 + multimeter on
OUT0 + a toggle switch on the MANUAL/AUTO GPIO + (optionally) a USB-UART
device replaying recorded VE.Direct frames. No relay yet — its logic can be
validated with an LED on the AUTO-assert line.

## To be added in Milestone 3 (after real currents are measured)

- calculated fuse table (main, MPPT battery-side, DC/DC, hotel circuits)
- cable cross-section table with lengths and voltage-drop targets (≤3 %
  control, ≤5 % propulsion)
- contactor part selection and pre-charge if the controller needs it
- torque specs and terminal hardware list
