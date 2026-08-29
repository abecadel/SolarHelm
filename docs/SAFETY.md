# SolarHelm Safety Design

Propulsion is safety-critical machinery. A wrong throttle command can pin a
boat against a dock, drag a swimmer, or strand a crew. SolarHelm is
therefore designed so that **no single failure — software or hardware — can
result in maintained or increased propulsion**, and so that a human always
has an authority path that does not pass through SolarHelm at all.

## Non-negotiable principles

1. **SolarHelm never switches motor current.** It emits a low-power
   throttle *signal* to a commercial motor controller which owns the
   high-current path, its own overcurrent/thermal protection, and
   high-throttle-at-start protection.
2. **The kill switch is independent.** The lanyard kill switch acts on the
   motor controller's enable/contactor circuit directly. SolarHelm may
   *sense* it; it must never *implement* it.
3. **MANUAL is the default state of matter.** Automatic control exists only
   while software actively and continuously asserts it (see the relay
   design below). Losing power, crashing, or being unplugged all decay to
   MANUAL.

## The fifteen fail-safe requirements

How each of the project's fail-safe requirements is (or will be) met.
"Core" = implemented and tested in `lib/solarhelm` today; "HW" = hardware
design rule for Milestones 2–3; "FW" = ESP32 firmware duty in Milestone 2.

| # | Requirement | Where | Mechanism |
|---|---|---|---|
| 1 | Physical kill switch independent of SolarHelm | HW | lanyard switch in the controller enable/contactor loop; SolarHelm not in that circuit |
| 2 | Manual throttle always available | HW | MANUAL/AUTO relay (below); manual pot wired to the controller through the relay's **normally-closed** contacts |
| 3 | MCU crash must not command propulsion | HW+FW | DAC output only reaches the controller through the relay's normally-open contacts, held by a firmware-fed heartbeat; watchdog reboot drops the relay |
| 4 | Invalid DAC output detected where possible | HW+FW | MCU ADC reads back the DAC/clamp output; disagreement ⇒ drop AUTO, log fault |
| 5 | Sensor timeout ⇒ safe state | Core | `SafetySupervisor`: battery data older than 3 s ⇒ `allow_auto=false` ⇒ forced MANUAL, command 0 (tested: `ShuntFailure` scenario) |
| 6 | SmartShunt data loss ⇒ exit SOLAR | Core | same path; auto modes cannot re-engage without fresh, plausible data AND an explicit request |
| 7 | Watchdog resets MCU on lockup | FW | ESP32 task+RTC watchdogs enabled; reboot lands in MANUAL (req. 10) |
| 8 | Hardware upper bound on throttle output | HW | resistive divider/zener clamp between DAC and controller caps the voltage regardless of software |
| 9 | Throttle ramps from zero after startup | Core | controller `reset()` on every auto activation; ramp limiter starts at 0 (tested) |
| 10 | Never restore previous throttle after reboot | Core | `Helm` constructs in MANUAL with zero command; no persisted throttle exists at all (tested) |
| 11 | Explicit activation of automatic mode | Core | `requestMode()` required; refused until at least one healthy tick (tested) |
| 12 | Reverse never selected automatically (V1) | Core+HW | core has no reverse concept; wiring gives automatic path forward polarity only |
| 13 | Automatic control forward-only | Core+HW | same as 12 |
| 14 | Log every safety transition | Core | `ITransitionLogger` receives every mode change with reason (tested); firmware persists to flash/SD |
| 15 | Obvious AUTO/MANUAL indication | HW+UI | relay state LED + buzzer chirp on transition; mode is the first telemetry field |

## The MANUAL-default relay (hardwired)

```
                             +5 V (from SolarHelm's supply)
                                │
                     MCU GPIO ──┤ heartbeat-driven transistor
                     (AUTO      │ (software must actively hold it)
                      assert)   ▼
                        ┌──────────────┐
                        │ RELAY coil   │  normally DE-energized
                        └──────┬───────┘
   Manual throttle pot ── NC ──┤
                               ├──── throttle input of motor controller
   DAC + hardware clamp ── NO ─┤
```

- The relay coil is **normally de-energized**: unpowered SolarHelm, a
  crashed MCU, a stuck watchdog, a blown fuse — all leave the manual
  throttle connected through the normally-closed contacts.
- Firmware asserts AUTO with an AC heartbeat (e.g. 10 Hz toggling through a
  charge-pump/monostable), not a static level, so a GPIO stuck high cannot
  hold AUTO. The physical MANUAL/AUTO switch is in series with the coil —
  the human always wins.
- The DAC path additionally passes a hardware clamp (max-voltage limit) and
  a pull-down that defines 0 V (= zero throttle) whenever the DAC is
  disconnected or unpowered.

## Software safety architecture (implemented + tested today)

- **Freshness before plausibility before use**: every sample carries its
  timestamp; the supervisor rejects stale (>3 s) then physically impossible
  battery data (SOC ∉ [0,100], V ∉ [6,70], |I| > 1000 A).
- **Verdict enforcement is structural**: `Helm::step()` is the only place a
  command is produced, and it zeroes the command and forces MANUAL whenever
  the verdict forbids auto — there is no code path around it.
- **No auto-resume**: after a safety dropout the mode stays MANUAL even
  when data returns; a new explicit `requestMode()` is required
  (tested: `helm_shunt_loss_forces_manual_with_zero_command`).
- **Invalid configuration locks MANUAL** permanently and raises
  `kFaultConfigInvalid` every tick.
- **Reserve floor**: at reserve SOC the target battery power is floored at
  +deadband and latched with hysteresis — the boat keeps station on solar
  but refuses to spend the reserve (tested: Scenario D).
- **GPS and MPPT telemetry are non-critical by design**: their loss flags
  faults and pauses efficiency accounting but never drops the cruise —
  a controller that aborts on a GPS glitch teaches users to bypass it.
- Fault flags (`kFault*`) travel in every telemetry record, so the UI and
  logs always show *why* something happened.

## What SolarHelm must never be trusted with

Even fully implemented, SolarHelm does not replace:
- the helmsman's watch (collision, navigation, weather);
- the motor controller's current/thermal limits;
- the BMS's cell protection;
- fusing and the battery main switch (docs/WIRING.md);
- the kill switch.

Do not rely on software alone for propulsion safety. Every Milestone-2/3
bring-up step in docs/ROADMAP.md starts with the motor disconnected or the
propeller out of the water for exactly this reason.
