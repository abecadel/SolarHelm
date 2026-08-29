# SolarHelm Buying Guide

Component research and three build levels (BOM A/B/C) for the 24 V
reference prototype. **All prices in PLN.**

**Price/conversion policy.** Snapshot date **2026-08-29**; EUR converted
at **4.34 PLN/EUR** (mid-market, 2026-08-28). Prices marked *(extract)*
were captured from search-engine extracts of the shops' live listings —
the research environment could not open many Polish shop pages directly —
so **re-check every price on the linked page before ordering**. Where a
listing could not be confirmed at all it is marked UNVERIFIED and an
alternative is given. No links are fabricated; every URL below appeared
in live search results or was fetched.

---

## Master component table

Columns: Component / Manufacturer / Exact model / Purpose / Key specs /
Required rating / Actual rating / Compatibility notes / Approx. price /
PLN / Purchase link / Docs link / Req(uired)-Opt(ional) / Proto(type)-Prod(uction).

| Component | Manufacturer | Exact model | Purpose | Key specifications | Required rating | Actual rating | Compatibility notes | Approx. current price | Price PLN | Purchase link | Official documentation | Req/Opt | Proto/Prod |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Trolling motor | STORM (Bezwiosel import) | N86Lbs 24 V | propulsion | 86 lbs thrust, 24 V, ~1164 W, 9.2 kg, 5F/3R switch head | ~1.2 kW @ 24 V | 1164 W (class) | Brushed PM (class-inferred); resistor-tap head bypass + external controller conversion **must be verified by disassembly first** — see notes below | 980–999 PLN *(extract)* | **990** | https://bezwiosel.pl/kategorie/351-storm-n86lbs-24v-elektryczny-silnik-zaburtowy.html | none published | Req | Proto |
| Motor controller | Kelly Controls | KDS24100E | throttle-by-wire PWM drive | brushed PM, 12–24 V nom (8–30 V), 60 A cont / 100 A 1 min, 0–5 V + hall throttle, programmable, current/thermal/HPD protection | ≥55 A cont | 60 A cont / 100 A pk | 0–5 V input matches GP8403 DAC; set current limit ≤80 A to protect 100 A BMS | €202.46 *(extract; the 629 PLN reference could NOT be confirmed — likely net/old)* | **879** | https://www.kellycontrollers.eu/kds24100e | manual v2.9: https://media.kellycontroller.com/new/Kelly-KDSUserManualV2.9.pdf (mirror v2.7: https://www.cloudelectric.com/v/vspfiles/files/technical-documents/kelly/KDS/Kelly%20KDS%20Controllers%20User%20Manual.pdf) | Req | Proto+Prod |
| Battery (budget) | WattCycle | 24 V 100 Ah LiFePO4 | energy storage | LFP, 25.6 V, 2.56 kWh, 100 A BMS cont, ~20 kg, 483×239×168 mm, 4000+ cycles, warranty ~5 y (claim) | ≥60 A discharge | 100 A cont (peak unpublished) | BMS peak spec unknown — cap Kelly at ~80 A; no low-temp charge cutoff on older version | from 1684 PLN *(Ceneo extract)* | **1684** | https://www.ceneo.pl/182506706 | none found | Req | Proto |
| Battery (better) | LiTime | 24 V 100 Ah Bluetooth | energy storage | LFP, 2.56 kWh, 100 A BMS, **0 °C charge cutoff**, Bluetooth, ~20.8 kg, 333×176×240 mm, 4000+ cycles, 5 y warranty | ≥60 A | 100 A cont | Low-temp cutoff + app telemetry justify the premium; EU-variant IP rating UNVERIFIED | 2199,99 PLN (shop) / ~1940 Amazon.pl *(extracts)* | **2200** | https://litime.com.pl/akumulatory-24v-lifepo4/71-akumulator-litime-24v-100ah-bluetooth-l24v100100basicbt8a160.html | vendor site | Alt | Proto+Prod |
| Battery (reference from spec) | DIPOWER | DDABSSG24100 | energy storage | LFP 25.6 V/100 Ah/2560 Wh, 100 A charge, 20 kg, 240×390×300 mm, 6000+ cycles (claim) | ≥60 A | ~100 A (implied) | **Polish availability/1999 PLN UNVERIFIED** — brand retails mainly in UA; PL: mrakumulator.com carries it (price uncaptured). Warranty + BMS peak unknown | ~1999 PLN UNVERIFIED | (1999?) | https://www.mrakumulator.com/DIPOWER_2,6kWh_LV | https://ecodrive.in.ua/akumulyator-dipower-lifepo4-24v-100ah-2560wh-litiy-zalizo-fosfatniy-akumulyator-dlya-dbzh-ups/ | Alt | — |
| Battery (150 A BMS option) | AZO Digital / LP | 24 V 100 Ah 150 A BMS (heated, BT) | energy storage w/ headroom | 150 A BMS clears the controller's 100 A 1-min peak with margin | ≥100 A pk | 150 A cont | best headroom vs Kelly peak | price uncaptured | ? | https://www.speckable.pl/pl/product/95230,akumulator-lifepo4-litowo-zelazowo-fosforanowy-24v-100ah-150a-mata-grzewcza-bluetooth-bms-azo | — | Alt | Prod |
| Controller (MCU) | Espressif | ESP32-S3-DevKitC-1-N8R8 | SolarHelm brain | dual-core LX7 240 MHz, WiFi, BLE5, native USB, TWAI(CAN), 8 MB flash + 8 MB PSRAM | — | — | TWAI needs external transceiver (SN65HVD230) | ~68–105 PLN *(extracts; Waveshare clone 58–68)* | **85** | https://botland.store/esp32-wifi-and-bt-modules/26547-esp32-s3-devkitc-1-n8r8-wifi-bluetooth-development-board-with-esp32-s3-wroom-1-chip.html (alt: https://allegro.pl/produkt/waveshare-esp32-s3-dev-kit-n8r8-f67d0936-59c0-431a-9ab7-9b80393ca038) | https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/ | Req | Proto |
| Throttle DAC | DFRobot | DFR0971 (GP8403) | 0–5 V throttle output | 2-ch I2C DAC, 12-bit, 0–5/0–10 V, 3.3–5 V logic, 8 I2C addresses; **powers up at 0 V** (unless `store()`d — never store non-zero!) | 0–5 V out | 0–5 V/0–10 V | matches Kelly 0–5 V input; feed through hardware clamp + MANUAL/AUTO relay per docs/SAFETY.md | 55–56 PLN *(Allegro extract)* | **56** | https://allegro.pl/produkt/konwerter-dfrobot-dfr0971-386a3124-8452-4001-9c66-cd0dfa7afb38 | https://wiki.dfrobot.com/SKU_DFR0971_2_Channel_I2C_0_10V_DAC_Module | Req | Proto |
| Battery monitor | Victron | SmartShunt 500 A **IP65** (SHU065150050) | battery power/SOC (the control input) | 500 A/50 mV, 6.5–70 V, ±0.4 %, 0.01 A resolution, VE.Direct (19200, 3.3 V logic), Bluetooth | 24 V, ≥100 A | 500 A | IP65 was *cheaper* than the standard variant at snapshot — buy IP65 for a boat; VE.Direct straight into ESP32 UART | from 389 PLN *(Ceneo extract; standard variant 443–447)* | **389** | https://www.ceneo.pl/148599479 | protocol: https://www.victronenergy.com/upload/documents/VE.Direct-Protocol-3.34.pdf | Req | Proto+Prod |
| GNSS | u-blox (generic board) | NEO-M8N module board | speed/position for Wh/km | 72-ch, 3× concurrent GNSS, up to 10 Hz (5 Hz multi-GNSS), UART | 5 Hz SOG | 5–10 Hz | configure with u-center: 5–10 Hz, 115200, RMC/VTG only | 69,99 PLN *(Allegro extract)* | **70** | https://allegro.pl/listing?string=gps+neo+m8n | https://content.u-blox.com/sites/default/files/products/documents/u-blox8-M8_ReceiverDescrProtSpec_UBX-13003221.pdf | Req | Proto |
| MPPT (recommended) | Victron | SmartSolar MPPT 100/30 | PV charging + telemetry | 100 V PV max, 30 A (~880 W @24 V), VE.Direct + Bluetooth | per array half | 880 W @24 V | **2× units** (one per panel): shading immunity, redundancy, same VE.Direct parser as shunt | from 434 PLN each *(Ceneo extract)* | **434/szt** | https://www.ceneo.pl/105947191 | https://www.victronenergy.pl/solar-charge-controllers/smartsolar-100-30-100-50 | Req (BOM C) | Proto+Prod |
| MPPT (bigger single) | Victron | SmartSolar MPPT 100/50 | PV charging | 50 A (~1450 W @24 V), VE.Direct | ≥1.4 kW | 1450 W | single-controller alternative | from 606 PLN *(extract)* | **606** | https://www.ceneo.pl/105947192 | as above | Alt | Prod |
| MPPT (budget RS485) | EPEVER | Tracer 4210AN (⚠ not 4215AN) | PV charging + Modbus | 40 A, **PV max 100 V**, RS485 Modbus RTU | ≥1 kW | 1040 W @24 V | **4215AN (150 V) has no confirmed PL stock**; 100 V limit ⇒ max 2s strings of 450 W panels after cold-Voc check | 453,78 PLN *(Allegro extract)* | **454** | https://allegro.pl/produkt/regulator-ladowania-mppt-tracer-4210an-40a-12-24v-133fccd1-b401-4ddb-92f4-99391bdfea05 | register map: https://github.com/kasbert/epsolar-tracer | Alt | Proto |
| Solar panel | Jinko Solar | Tiger Neo JKM450N-54HL4R-V | PV generation | 450 W N-TOPCon, 1762×1134×30 mm, 21.0 kg, ~22.5 % module eff.; Vmp≈34.6 V, Voc≈41.6 V, Imp≈13.0 A (datasheet values UNVERIFIED this session) | ~450 W | 450 W | 54-cell format fits boats better than 72-cell; **0.62 PLN/W**; palletized shipping 100–250 PLN | 277,98 PLN brutto *(wholesale extract; 308–430 elsewhere)* | **278/szt** | https://megawat-elektrohurt.pl/p/1289/5152239/modul-fotowoltaiczny-panel-pv-450wp-jinko-jkm450n-54hl4r-v-n-type-tiger-neo-black-frame-czarna-rama-panele-monokrystaliczne-panele-pv-fotowoltaika.html | jinkosolar.com datasheet (verify frame revision) | Req (BOM C) | Proto+Prod |
| Solar panel (alt) | Longi | 450 W class (LR4-72HPH-450M) | PV | 72-half-cell PERC, ~23.5 kg | 450 W | 450 W | bigger/heavier 72-cell format | 330,87 PLN *(extract)* | **331** | https://eu-panele.pl/panele-fotowoltaiczne-450w | longi.com | Alt | — |
| Flexible panel (comparison) | VOLT Polska | MONO FLEX 100 W 18 V | PV where rigid can't go | 1020×540×4 mm, ~2.5 kg, ETFE | — | 100 W | **3.80 PLN/W — 6× the rigid price per watt**; per kg comparable (~25 vs ~21 W/kg). Only for curved/walked surfaces | 380 PLN *(shop extract)* | **380** | https://voltpolska.pl/fotowoltaika/panel-fotowoltaiczny-elastyczny-mono-100w-18v-1020x540mm-.html | vendor page | Opt | — |
| Main contactor | Albright | SW80 24 V | kill-switch-driven battery disconnect for drive | 100/125 A rated coil contactor | ≥60 A | 100–125 A | original vs clone; 24 V coil | 195 PLN net / 240 gross *(extracts)* | **240** | https://widlowe.pl/albright/711-stycznik-kpl-sw80-24v-100a-albright-oryginal-124949.html | albrightinternational.com | Req | Proto+Prod |
| Main fuse + holder | Hollywood (generic) | ANL 80 A + ANH-1 holder | battery short protection | 80 A ANL | above 60 A cont, below cable ampacity | 80 A | size FINAL fuse from measured current + cable (docs/WIRING.md) | ~69 PLN *(Allegro extract)* | **69** | https://allegro.pl/listing?string=bezpiecznik+anl+80a | — | Req | Proto+Prod |
| Battery switch | generic (Kamar class) | master switch 12/24 V 300 A | service disconnect | 300 A make/break | ≥100 A | 300 A | — | 28–79 PLN *(extracts)* | **45** | https://sklep.webtruck.pl/wylacznik-masy-hebel | — | Req | Proto+Prod |
| Kill switch | generic marine | lanyard kill switch (zrywka) | crew-overboard cutoff | NC lanyard switch in contactor coil loop | — | — | independent of SolarHelm per docs/SAFETY.md | 20–92 PLN *(extracts)* | **80** | https://4-marine.com/produkt/zrywka-bezpieczenstwa-z-linka-do-lodzi-do-mercury-mariner/ | — | Req | Proto+Prod |
| Battery cable | generic | H01N2-D 25 mm² (35 mm² for long runs) | high-current wiring | welding-class flex copper | 50 A cont/100 A pk, runs <3 m | 25 mm² ok | calculate per docs/WIRING.md | 18–32 PLN/m *(extracts)* | **~200 (6 m + lugs)** | https://spawmarket.pl/163-kabel-przewod-spawalniczy-25-mm-os.html | — | Req | Proto+Prod |
| DC/DC 24→5 V | generic | isolated 24→5 V 1 A (5 W) module | ESP32 supply | isolated, 5 W | ~3 W | 5 W | isolation = single-point control ground | 28–40 PLN *(extracts)* | **35** | https://allegro.pl/produkt/przetwornica-izolowana-b2405s-dc-dc-24v-5v-1w-b1d3fcc7-f793-4d8b-8f75-9480c42e1e10 (1 W version; buy the 1 A class) | — | Req | Proto |
| DC/DC 24→12 V | Mean Well | DDR-120B-12 | hotel loads 12 V rail | 120 W, DIN rail, 16.8–33.6 V in | per loads | 10 A | budget automotive 20 A bricks exist (~60–150 PLN, UNVERIFIED) | 288,26 PLN *(extract)* | **288** | via Mean Well PL distributors / Allegro | meanwell.com | Opt (BOM C) | Prod |
| RS485 transceiver | generic | MAX485 module | EPEVER Modbus | TTL↔RS485 | — | — | mind 3.3 V levels | ~12 PLN class UNVERIFIED | **12** | https://sklep.msalamon.pl / nettigo.pl | — | Opt | Proto |
| CAN transceiver | Waveshare | SN65HVD230 board | future CAN/VESC | 3.3 V, 1 Mbps | — | — | pairs with ESP32 TWAI | 17,50–21 PLN *(extracts)* | **19** | https://allegro.pl/oferta/modul-waveshare-can-sn65hvd230-12277563462 | ti.com datasheet | Opt | Prod |
| MANUAL/AUTO relay | generic automotive | 5-pin SPDT 40 A + socket (24 V coil version) | throttle path switching | SPDT, normally-closed = manual | — | 40 A (signal duty) | normally-de-energized = MANUAL per docs/SAFETY.md | 8–15 PLN *(extracts)* | **15** | https://allegro.pl/oferta/przekaznik-samochodowy-5-pin-12v-40a-gniazdo-6729209589 | — | Req | Proto+Prod |
| Display | generic | SSD1306 0.96" OLED I2C | status display | 128×64, I2C, 3.3/5 V | — | — | optional; web UI is primary | from 17 PLN *(Ceneo extract)* | **17** | https://www.ceneo.pl/185279213 | — | Opt | Proto |
| Enclosure | generic | ABS IP65 ~190×140×70 | electronics housing | IP65 | — | — | bigger 330×250×130 at 75–147 PLN | 28–39 PLN *(extracts)* | **35** | Allegro (multiple) | — | Req | Proto |

### ⚠ Before buying the Storm N86 conversion parts

The conversion assumes (class-level inference, **unverified for this
unit**): brushed PM motor, resistor-tap 5/3 speed head that can be
bypassed, reverse by polarity swap, ~48–50 A at full power. **Buy the
motor first, open the head, and verify the electrical topology before
buying the Kelly controller.** If it turns out to be something exotic,
the Haswing Osapian D80 MAX (built-in stepless PWM "maximizer",
~2300–2700 PLN UNVERIFIED) is the fallback; the Rhino BLX 24 V line is
brushless and NOT compatible with the KDS.

---

## BOM A — Bench prototype (no boat, no propulsion) — target < 1000 PLN

ESP32 + simulated sensors + DAC + signal-level testing (Milestone 2).

| Item | PLN |
|---|---|
| ESP32-S3-DevKitC-1-N8R8 (or Waveshare clone) | 85 |
| DFRobot DFR0971 GP8403 DAC | 56 |
| NEO-M8N GNSS board | 70 |
| SSD1306 OLED | 17 |
| RS485-TTL module | 12 |
| SN65HVD230 CAN transceiver (future-proofing) | 19 |
| Automotive relay + socket (MANUAL/AUTO logic mock) | 15 |
| Isolated 24→5 V module | 35 |
| Toggle switch, LEDs, buzzer, breadboard, wires, resistors | ~80 |
| USB-UART adapter (VE.Direct replay from laptop) | ~25 |
| **Total** | **≈ 414 PLN** ✅ well under 1000 |

A multimeter and a bench PSU are assumed owned (add ~150–250 PLN if not).

## BOM B — Cheap real-boat prototype — target 5000–7000 PLN (beaten)

Everything to move a boat under SolarHelm supervision (Milestone 3), no
solar yet. Excludes the boat.

| Item | PLN |
|---|---|
| STORM N86 24 V motor | 990 |
| Kelly KDS24100E controller | 879 |
| WattCycle 24 V 100 Ah LiFePO4 | 1684 |
| Victron SmartShunt 500 A IP65 | 389 |
| BOM A electronics (ESP32, DAC, GNSS, relay, DC/DC, misc) | ~414 |
| Albright SW80 24 V contactor | 240 |
| ANL 80 A fuse + holder | 69 |
| Battery master switch | 45 |
| Lanyard kill switch | 80 |
| 25 mm² cable ~6 m + lugs + glands | ~200 |
| IP65 enclosure + hardware clamp parts (divider/zener/monostable) | ~90 |
| Manual throttle potentiometer (5 kΩ) + helm hardware | ~40 |
| **Total** | **≈ 5120 PLN** ✅ inside target; ~4900 with Allegro-priced ESP32 clone and promo motor price |

Upgrade option: LiTime battery (+516 PLN → ~5640) buys the 0 °C charge
cutoff and Bluetooth — recommended if the boat will see shoulder-season
use.

## BOM C — Solar cruiser prototype — max value per PLN

Adds the energy system for real solar cruising (Milestone 4). Start at
900 Wp (2 panels); the architecture scales to 1.8 kWp by repeating the
panel+MPPT pair.

| Item | PLN |
|---|---|
| BOM B | 5120 |
| 2× Jinko Tiger Neo 450 W (wholesale) | 556 |
| Panel shipping (palletized) | ~150–250 |
| 2× Victron SmartSolar MPPT 100/30 | 868 |
| Panel mounting (alu profiles, clamps, backing) | ~300 |
| Mean Well 24→12 V 120 W (hotel rail) | 288 |
| PV wiring (MC4, 6 mm² solar cable, PV fuses) | ~150 |
| Marine-grade extras (glands, tinned wire, terminal blocks) | ~150 |
| **Total** | **≈ 7600–7700 PLN** (≈ 8.4 PLN per watt-of-array + full drive system) |

Scaling note: each further +900 Wp ≈ +1550 PLN (2 panels + 1–2 MPPTs +
mounting). At 1.8 kWp total the battery becomes the bottleneck on dull
days, not the array.

## Where cheap is acceptable — and where it is not

**Cheap is fine:** ESP32 board (clone ok), OLED, RS485/CAN modules,
enclosure, automotive relay (it only switches a 0–5 V signal), rigid
residential panels (the whole point — 0.62 PLN/W vs 3.8 PLN/W "marine"),
generic NEO-M8N GNSS, welding cable as battery cable.

**Do not cheap out:** the **motor controller** (current limiting and
thermal cutback are your motor's life insurance — no-name "100 A" PWM
boards have neither; bench-only), the **shunt** (it is the control
input; ±0.4 % Victron accuracy and a documented protocol beat any
no-name coulomb counter), the **battery/BMS** (unknown chemistry or
undocumented BMS limits are disqualifying — all three recommended packs
have published BMS continuous ratings), **fusing/contactor/kill switch**
(safety chain), and **PV connectors/crimps** (fire risk done badly).

## Link-quality caveats

Every link above was live in search results on 2026-08-29. Prices marked
*(extract)* were not confirmable on the shop page from the research
environment (proxy restrictions) — treat as ±10 % until checked. Known
gaps, honestly flagged: DIPOWER's Polish price (1999 PLN) could not be
verified and the brand mainly retails in Ukraine — WattCycle/LiTime are
the recommendation instead; Kelly's 629 PLN reference could not be
confirmed (EU shop shows €202.46 ≈ 879 PLN); the EPEVER Tracer 4215AN
(150 V) appears unavailable in Poland — buy the 4210AN (100 V, with
string-design care) or Victron. At least one alternative is listed for
every critical component (motor, controller, battery, MPPT, panels).
