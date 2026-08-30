// AppLink — the phone <-> boat protocol core, hardware-free.
//
// The ESP32 serves a tiny HTTP JSON API over its own SoftAP (see
// firmware/): GET /telemetry returns the record from writeTelemetryJson();
// POST /remote carries a body parsed by parseRemoteCommand(). Everything
// with logic lives here so it is desktop-testable to the 100% gate; the
// firmware only moves bytes.
//
// Design rules (docs/SAFETY.md, docs/ARCHITECTURE.md):
//  - fixed buffers, no dynamic allocation, no exceptions
//  - the parser is tolerant of extra keys/whitespace but strict about the
//    value: a request that does not contain one finite, plausible
//    "target_w" number is INVALID and must be ignored by the caller —
//    never "best-effort" interpreted into a throttle change

#pragma once

#include <cstddef>

#include "sh/core/config.h"
#include "sh/telemetry/telemetry.h"

namespace sh {

// Upper bound accepted from the wire; generous vs any supported motor so
// a garbage payload cannot masquerade as a huge valid target.
constexpr float kRemoteTargetMaxW = 100000.0f;

// Serializes a telemetry record as one compact JSON object. snprintf-style
// return: >= buf_len means the output was truncated (give it ~512 bytes).
int writeTelemetryJson(const TelemetryRecord& r, char* buf, size_t buf_len);

struct RemoteCommand {
    bool valid = false;
    float target_w = 0.0f;
};

// Parses a phone request body like {"target_w": 350.5}. Whitespace-
// tolerant, other keys ignored; valid only when the value is a finite
// number in [0, kRemoteTargetMaxW].
RemoteCommand parseRemoteCommand(const char* body, size_t len);

// ---- Runtime-tunable configuration over the link ----
//
// A deliberate WHITELIST of ControlConfig fields the app may read and
// patch: behavior tuning only — gains, deadband, ramps, targets,
// reserve, timeouts. Protection-envelope thresholds (voltage sag,
// current cap, temperature) are NOT remotely writable by design: they
// change with a screwdriver and a datasheet, not from a phone.
struct ConfigField {
    const char* name;
    float ControlConfig::* member;
};
extern const ConfigField kConfigFields[];
extern const size_t kConfigFieldCount;

// Serializes the whitelisted fields as one JSON object. snprintf-style.
int writeConfigJson(const ControlConfig& cfg, char* buf, size_t buf_len);

struct ConfigPatchResult {
    bool valid = false;         // patch parsed AND validated
    bool malformed = false;     // a recognized key had an unparsable value
    int fields_applied = 0;     // recognized keys with finite values
    ConfigError error = ConfigError::kNone;  // validation verdict
};

// Applies a JSON body of whitelisted keys onto a COPY of `current`,
// validates, and only writes `out` when everything passes. Unknown keys
// are ignored; a recognized key with a non-finite value invalidates the
// whole patch; a patch with zero recognized keys is invalid.
ConfigPatchResult applyConfigPatch(const ControlConfig& current,
                                   const char* body, size_t len,
                                   ControlConfig* out);

}  // namespace sh
