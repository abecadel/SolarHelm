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

}  // namespace sh
