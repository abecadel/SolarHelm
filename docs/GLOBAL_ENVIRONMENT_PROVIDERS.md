# Global Environment Providers

Research for SolarHelm's global-first environmental data layer. Research
date 2026-08-30; many vendor pages were reachable only as search extracts
from the research sandbox — rows note UNVERIFIED where a fact could not be
double-checked. Companion documents:
[GLOBAL_ADAPTIVE_ROUTE_PLANNER_RESEARCH.md](GLOBAL_ADAPTIVE_ROUTE_PLANNER_RESEARCH.md)
(the planner that consumes this data) and
[ADAPTIVE_ENERGY_MODEL_RESEARCH.md](ADAPTIVE_ENERGY_MODEL_RESEARCH.md)
(how telemetry corrects it).

**Design law: no provider is hard-coded into the planner.** Everything
below plugs in behind capability interfaces (`WeatherProvider`,
`WaveProvider`, `CurrentProvider`, `TideProvider`, `SolarProvider`,
`BathymetryProvider`) selected through a versioned registry (see
§Selection).

## Provider comparison

Columns: coverage / variables / spatial / temporal / horizon / archive /
API / auth / cost / licence / offline suitability / coastal accuracy.

| Provider | Coverage | Variables | Spatial res. | Temporal | Horizon | Archive | API | Auth | Cost | Licence | Offline suitability | Coastal accuracy | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Copernicus Marine GLOBAL_ANALYSISFORECAST_PHY_001_024** (incl. **SMOC** merged surface currents = model+tide+Stokes) | Global ocean | currents u/v, SSH, T, S | 1/12° (~8–9 km) | hourly surface | 10 d, daily update | from ~2020 (+GLORYS12 reanalysis 1993→) | Copernicus Marine Toolbox → ARCO Zarr (MOTU retired) | free registration | free | CMEMS SLA, attribution, commercial OK | excellent via backend corridor subsetting; **not browser-direct** | 9 km grid misses channels/headland races | the authoritative global current source; SMOC sums the three drift components a boat feels |
| **Copernicus GLOBAL_ANALYSISFORECAST_WAV_001_027** (MFWAM) | Global | Hs, periods, direction, wind-wave + 2 swell partitions, Stokes drift | 1/12° | **3-hourly** (corrects the "hourly" preliminary) | 10 d | yes | as above | as above | free | as above | as above | no nearshore shoaling; fetch-limited seas (bora chop) underestimated | keep partitions — wind-wave drives added resistance, long swell mostly doesn't |
| **CMEMS regional** (Med 1/24°≈4 km; Baltic 1 nm; NWS ~1.5 km, IBI ~1/36°, Black Sea, Arctic — last four UNVERIFIED res.) | Regional EU seas | same families | 1.5–4 km | hourly | ~10 d | yes | same catalog/auth/API | same | free | same | same backend pattern | much better; still not harbour-scale | one catalog with STAC-style extents = selection metadata for free |
| **Open-Meteo Marine** | Global (aggregates MFWAM/SMOC, GFS-Wave 0.16°, DWD EWAM 0.05° regional, ECMWF WAM, BOM) | waves (+partitions), **ocean currents**, SST, sea_level_height_msl | ~8 km (waves/currents), 5 km regional waves | hourly output | ~7 d (per-model max UNVERIFIED) | yes (Historical + Historical *Forecast* APIs — error-statistics gold) | **REST/JSON + FlatBuffers, CORS, browser-direct** | none | free non-commercial | CC-BY 4.0 | **ideal**: batch waypoint fetch → IndexedDB | their own warning: 8 km tides/currents unreliable in constrained coastal water; sea level is MSL, never chart datum | **Tier-0 backbone for the PWA**; same transport as our existing weather usage |
| **Open-Meteo Weather/Solar** | Global, `best_match` auto-selects 1–2 km regional (AROME/ICON-D2/HRRR/UKV…) → 9–13 km global (IFS/ICON/GFS) | full weather + **GHI/DNI/DHI**, 15-min where regional | 1–13 km | hourly/15-min | up to 16 d (model-dep.) | ERA5 to 1940 + Historical Forecast | REST/JSON, CORS | none | free non-comm. | CC-BY 4.0 | ideal | good | `best_match` IS the provider-selection pattern to imitate |
| **NOAA CO-OPS** (US) | US + territories, station-based | tide **and current** predictions + obs | stations | 6-min/hourly | predictions years ahead | yes | REST/JSON, free | none | free | US Gov open | good (station packs); harmonic constituents downloadable → offline | authoritative at stations | CORS UNVERIFIED — plan proxy fallback |
| **NOAA OFS** (CBOFS, SFBOFS, NGOFS2, WCOFS, Great Lakes…) | US harbours/estuaries/shelf | 3-D currents, water level, T, S | ~100 m–4 km unstructured | hourly, 4 runs/day | 48 h | S3 since 2025 | NetCDF via THREDDS/**public S3** | none | free | US Gov | backend subsetting (unstructured grids) | **best-in-class US harbour currents** | the model tier global products can't touch |
| **NOAA GFS-Wave / GFS** | Global | waves 0.25°/0.16°, weather | 13–25 km | 3-hourly | **16 d** | yes | GRIB2 NOMADS (corridor subsetting via grib-filter URL) / S3 | none | free | US Gov | GRIB decode needed → consume via Open-Meteo in practice | coarse | longest free wave horizon (passage look-ahead) |
| **HYCOM → Navy ESPC-D-V02** | Global | currents, T, S | 1/25° det. (1/12° served grid) | daily runs | ~ | GOFS archives 1994–2024 | THREDDS/OPeNDAP | none | free | US Navy/open | backend only | research-grade, no SLA | **GOFS 3.1 decommissioned 2024-09-04** — second-opinion source only |
| **ECMWF Open Data** | Global | IFS/AIFS weather + **ECWAM waves** | 0.25° | 3–6-hourly steps | 10–15 d | partial | GRIB2 over HTTPS (whole-globe files) | none | free | **CC-BY 4.0** | backend/ensemble member (tens of MB per field/step) | coarse | radiation params in open subset UNVERIFIED |
| **MET Norway** | Locationforecast: global; **oceanforecast: Norwegian waters** (WW3 4 km + **NorKyst-800 800 m** currents) | weather; waves+currents+SST | 800 m–4 km (NO), 2.5 km MEPS Nordics | hourly | ~10 d / ~2–3 d ocean | via thredds.met.no | REST/JSON, browser-usable (Origin header accepted) | none | free | NLOD/CC-BY | good | excellent (Norway) | wave dir = FROM, current dir = TO — parse carefully |
| **DMI / SMHI** (DK/SE) | Danish/Swedish waters | obs + WAM waves, DKSS surge, HARMONIE | regional | hourly | days | yes | open-data REST (DMI keyed, SMHI keyless) | free key / none | free | open licences | good | good | genuine open-data programmes |
| **UKHO Admiralty Tidal API** | UK/IE, 607 stations | tide events; streams (paid tier) | stations | events | 6 d free / 1 yr paid | — | REST | key | free tier / £144–360 yr | proprietary; **free tier forbids caching** → incompatible with offline-first | n/a | authoritative | paid Foundation tier if UK tidal streams ever needed |
| **SHOM** (FR) | France | tides | stations | — | — | — | key | **paid** | proprietary | poor | authoritative | skip for now |
| **CHS IWLS** (Canada) | Canada, 700+ stations | water levels + some **currents**, predictions/obs/forecasts | stations | 6-min+ | yes | REST/JSON (Swagger) | none | free | open | good | authoritative | their own public tide app is a PWA on this API |
| **ECCC MSC GeoMet** (Canada) | Canada + global models | GDPS/HRDPS weather, **GDWPS waves** | 1–25 km | hourly | days | yes | WMS + **OGC API-EDR** (JSON point extraction) | none | free | open | decent | good | EDR is genuinely browser-friendly (CORS UNVERIFIED) |
| **BOM** (Australia) | AU region | AUSWAVE, OceanMAPS currents, ACCESS | regional | — | 7 d | — | **no public API**; registered FTP; hostile to scraping | reg. | free-ish | restrictive | poor direct | — | reach via **Open-Meteo (ingests ACCESS/AUSWAVE)** or Pacific Data Hub THREDDS |
| **FES2022** (CNES/AVISO) | **Global tide atlas** | 34 constituents, elevation (+currents in FES family) | 1/30° | n/a (harmonics) | **forever** | n/a | download (registration) + open-source PyFES/aviso-fes predictor | free reg. | free | AVISO licence (redistribution terms UNVERIFIED — verify before bundling packs) | **the only fully-offline global tide answer**: ~272 B/point constituent packs, synthesize on-device | MSL-referenced; degrades in shallow estuaries | build-time extraction step; ship per-region packs |
| **WorldTides.info** | Global aggregator | tide heights/extremes/**constituents**/datums | stations+grid | — | — | — | REST | key | credits (~1 credit/request class) | commercial | buy-once constituents → cache offline (ToS UNVERIFIED) | good | pragmatic global fallback where FES is weak |
| **Open-Meteo Flood (GloFAS)** | **Global rivers** | river **discharge** (no velocity/stage) | ~5 km | daily | 7 d (+ens. 30 d) | 1984→ | REST/JSON, CORS | none | free | CC-BY | ideal | 5 km may pick the wrong river — jitter coords | the inland-waters baseline |
| **USGS / PEGELONLINE / EA** (US/DE/UK gauges) | national | stage, discharge, (some velocity) | stations | 5–15 min | obs (+some fcst) | yes | REST/JSON, free, no key (PEGELONLINE DL-DE-Zero) | none | free | open | good | station-accurate | the learned river-current model's calibration input |
| **PVGIS 5.3** (EU JRC) | SARAH: EU/Africa/Asia+; ERA5: global | historical solar/PV yield, TMY | 0.05–0.28° | hourly hist. | n/a | yes | REST/JSON, no key | none | free | open | good (climatology packs) | n/a | validation/climatology, **not** a live forecast |
| **CAMS solar** / **NASA POWER** | ±66° / global | satellite-derived + reanalysis radiation history | 3–50 km | 1-min–hourly | n/a | yes | API (reg.) / REST | reg./none | free | open | good | n/a | ground truth for validating forecast providers |
| **GEBCO_2025** / EMODnet / NOAA BlueTopo | global / EU / US | bathymetry | 15″ (~460 m) / ~115 m / survey | n/a | n/a | n/a | download/OPeNDAP/WMS | none | free | attribution | corridor packs are tiny (38 KB per 200×20 km) | **not survey-grade nearshore** — never for under-keel decisions | depth-aware routing later |

## The tier architecture

```
Tier 0  browser-direct, keyless, CORS, global — always works
        Open-Meteo weather/solar + marine + flood
        FES2022-derived tide constituent packs (static app assets)
Tier 1  free+registration, backend or build-step, global
        CMEMS global PHY(SMOC)+WAV · ECMWF open data · Navy ESPC
Tier 2  regional upgrades, auto-selected by coverage
        CMEMS regional · MET Norway NorKyst · NOAA OFS/CO-OPS ·
        CHS IWLS · DMI/SMHI · GeoMet EDR · BOM-via-Open-Meteo
Tier 3  paid plug-ins (optional)
        UKHO streams · SHOM · WorldTides credits · Solcast
```

Every Tier ≥ 1 source reaches the PWA as a **pre-fetched corridor pack**
(built by a small backend job or a shore-WiFi step); Tier 0 works with no
infrastructure at all. Nothing in the logic names a country — only
coverage geometry, capability, and cost class.

## Selection: how SolarHelm knows what covers a coordinate

A versioned **provider registry** ships with the app (JSON):
`{id, tier, capabilities[], coverage (global | bbox | coarse polygon),
resolution_deg, update_h, horizon_h, auth, cost_class, transport}`.
Lookup is point-in-polygon returning a capability-sorted candidate list
per variable. The registry is generated at build time from provider
metadata (the CMEMS catalog exposes STAC-style extents; Open-Meteo's model
domains are in its open-source repo; NOAA lists OFS domains). Runtime
rule: **coverage polygons are hints, responses are truth** — a provider
returning null/NaN for a point demotes itself.

Selection cascade per variable (the getBestCurrentForecast concept):
validated regional model → national/local model → global model → learned
historical bias (H3-cell corrections, see ADAPTIVE_ENERGY_MODEL doc) →
telemetry-inferred estimate. Regional data **overrides inside its domain
with a cross-fade** (~2 coarse-grid cells) so routes crossing a domain
edge see no step. Every response carries metadata
`{source, model, resolution, forecast_age, horizon, confidence}` that
feeds the uncertainty model.

## Uncertainty from provider metadata

Two multiplicative terms per variable: (a) **representativeness error** —
σ inflated by grid size and coastal complexity (within ~3 grid cells of a
coast, current σ ×2–3); (b) **learned forecast-error statistics** —
Open-Meteo's Historical *Forecast* API archives what was forecast, and
ERA5/NDBC/CO-OPS/IWLS provide what happened; σ(lead time, provider,
region-class) is regressed offline and shipped as a table, then updated by
the boat's own residuals. Priors until learned: global currents
σ ≈ 0.1–0.2 kn offshore, 0.5+ kn nearshore; Hs σ grows ~15–25 %/day of
lead time.

## Ensembles

A "poor man's ensemble" is nearly free: Open-Meteo exposes ECMWF, GFS,
ICON, Météo-France, BOM individually via `models=` — 2–4 independent
opinions through one transport. Use spread to inflate σ and a
skill-weighted mean as the estimate. True probabilistic members (ECMWF
ENS, GloFAS percentiles) multiply cache size — cache p10/p50/p90, not
members. Full learned per-region blending is V2+, per the spec.

## Inland waters

Different physics, worse data: no wave products (fetch-trivial), and **no
provider anywhere serves navigable-river current velocity**. Available
signals: GloFAS discharge (global, daily, via Open-Meteo Flood) and
national gauges (USGS/PEGELONLINE/EA — free JSON). SolarHelm therefore
maintains **learned per-reach ratings** `current(stage/discharge)` seeded
by hydraulic heuristics (v ≈ a·Q^b, b≈0.34) and refined from SOG−STW
residuals — a *learned provider* behind the same `CurrentProvider`
interface, with its confidence clearly labeled (forecast vs learned vs
realtime-inferred). Locks/dams: no general API (EU RIS/Notices-to-Skippers
feeds are patchy XML — future work). The coverage lookup must classify
"inland" and switch stacks — a capability-registry consequence, not a
special case.

## Offline caching (what to fetch before departure)

Cache **route-corridor time series, not grids**. Worked example (200 km
route, 20 km corridor, 5 days, ~120 sample points): currents hourly
115 KB, waves 3-hourly 154 KB, weather+solar hourly 691 KB, tide
constituents < 50 KB (never expire), GEBCO corridor 38 KB — **≈1 MB as
typed arrays (0.3 MB gzipped)**; store binary (FlatBuffers/Float32Array)
in IndexedDB/OPFS, never raw JSON (5–10×). Even a full-Adriatic 7-day
gridded pack is ~15–30 MB. Refresh on any connectivity; stamp issue time
and inflate σ with cache age (+~20 %/day).

## Direct answers (providers subset of the 22 questions)

**Q1 — best global current baseline:** CMEMS
GLOBAL_ANALYSISFORECAST_PHY_001_024, specifically **SMOC** (model + tide +
Stokes drift — the three components a small boat actually feels), 1/12°,
hourly, 10-day; delivered to the PWA zero-infrastructure as Open-Meteo
Marine currents (*Open-Meteo as transport, CMEMS as source of truth*).
ESPC (ex-HYCOM) is the independent second opinion — note GOFS 3.1 was
decommissioned 2024-09.

**Q2 — best global wave baseline:** CMEMS WAV_001_027 (MFWAM 1/12°,
3-hourly, partitioned wind-wave/swell + Stokes), again browser-reachable
via Open-Meteo; NOAA GFS-Wave (16-day) and ECMWF ECWAM (CC-BY) as
ensemble members. Keep the partitions.

**Q3 — regional-model strategy:** layered override with cross-fade, never
replacement; global always computed as fallback + second member;
selection by capability score (resolution, freshness, variables, verified
skill), never by region name. Precedents: Open-Meteo `best_match`, CMEMS'
own regional nesting.

**Q4 — automatic coverage determination:** build-time provider registry
with coverage polygons + capabilities, point-in-polygon lookup,
response-validation demotion. Refreshable, versioned, shipped with the
app.

**Q5 — resolution/accuracy → uncertainty:** representativeness term from
resolution × coastal complexity, plus learned σ(lead, provider, region)
from historical-forecast-vs-truth archives; both attach (μ, σ) to every
environmental input.

**Q7 — ensembles:** feasible now for wind/solar/waves through Open-Meteo's
`models=`; currents need the backend tier; spread → σ, skill-weighted
mean → estimate; learned per-region weights deliberately deferred past V1.

**Q8 — inland differences:** wave pipeline off, river-current becomes the
dominant term with **no forecast provider** — the learned per-reach rating
is the provider; tides → lock/dam operations; provider stack switched by
the coverage classifier.

**Q21 — pre-departure cache:** see §Offline caching (≈1 MB corridor pack +
tide constituents + basemap; full list in the route-planner doc).

## Open verification items

CORS status of NOAA/GeoMet/IWLS/NDBC; CMEMS browser accessibility and
exact SMOC dataset IDs; Open-Meteo per-model horizons and current-model
provenance; FES2022 redistribution terms for bundled constituent packs;
ECMWF open-data radiation params; BSH/DHMZ/Danube-RIS APIs; regional CMEMS
resolutions marked UNVERIFIED above.
