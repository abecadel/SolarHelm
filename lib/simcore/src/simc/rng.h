// Deterministic PRNG for simulations (xorshift32).
// Identical sequences on every platform and run — a scenario with the same
// seed always produces the same CSV, which the tests rely on.

#pragma once

#include <cstdint>

namespace simc {

class Rng {
public:
    explicit Rng(uint32_t seed) : state_(seed == 0 ? 0x9e3779b9u : seed) {}

    uint32_t next() {
        uint32_t x = state_;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        state_ = x;
        return x;
    }

    // Uniform in [0, 1).
    float nextFloat() {
        return static_cast<float>(next() >> 8) /
               static_cast<float>(1u << 24);
    }

private:
    uint32_t state_;
};

}  // namespace simc
