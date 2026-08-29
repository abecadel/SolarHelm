// Minimal dependency-free test framework for SolarHelm desktop tests.
//
// Why not Unity/GoogleTest: the project rule is that desktop tests build
// with nothing but g++ and make (see docs/ARCHITECTURE.md §Toolchain), so
// the harness is ~70 lines we own. Assertion macros continue on failure and
// the process exit code reports the total.
//
// Usage:
//   TEST(my_case) { CHECK(1 + 1 == 2); }
//   TEST_MAIN()

#pragma once

#include <cmath>
#include <cstdio>
#include <vector>

namespace shtest {

struct TestCase {
    const char* name;
    void (*fn)();
};

inline std::vector<TestCase>& registry() {
    static std::vector<TestCase> tests;
    return tests;
}

inline int& failures() {
    static int count = 0;
    return count;
}

inline int runAll() {
    for (const TestCase& t : registry()) {
        const int before = failures();
        t.fn();
        std::printf("[%s] %s\n", failures() == before ? "PASS" : "FAIL",
                    t.name);
    }
    if (failures() > 0) {
        std::printf("%d assertion(s) FAILED\n", failures());
        return 1;
    }
    std::printf("all %zu test(s) passed\n", registry().size());
    return 0;
}

}  // namespace shtest

#define TEST(name)                                             \
    static void test_fn_##name();                              \
    static const bool test_reg_##name = [] {                   \
        shtest::registry().push_back({#name, test_fn_##name}); \
        return true;                                           \
    }();                                                       \
    static void test_fn_##name()

#define CHECK(cond)                                                        \
    do {                                                                   \
        if (!(cond)) {                                                     \
            ++shtest::failures();                                          \
            std::printf("  CHECK failed: %s (%s:%d)\n", #cond, __FILE__,   \
                        __LINE__);                                         \
        }                                                                  \
    } while (0)

#define CHECK_NEAR(a, b, tol)                                              \
    do {                                                                   \
        const double va = (a);                                             \
        const double vb = (b);                                             \
        if (std::fabs(va - vb) > (tol)) {                                  \
            ++shtest::failures();                                          \
            std::printf("  CHECK_NEAR failed: %s=%g vs %s=%g (%s:%d)\n",   \
                        #a, va, #b, vb, __FILE__, __LINE__);               \
        }                                                                  \
    } while (0)

#define TEST_MAIN() \
    int main() { return shtest::runAll(); }
