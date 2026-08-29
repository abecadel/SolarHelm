# SolarHelm — desktop build: simulator, unit tests, coverage.
#
#   make sim        build the simulator          -> build/sim
#   make test       build + run all unit tests   -> build/tests/*
#   make scenarios  run every scenario           -> sim/out/*.csv
#   make coverage   tests + scenarios under gcov -> coverage report (100% gate)
#   make clean
#
# No dependencies beyond g++ (C++17), make, and lcov for `make coverage`.
# The ESP32 firmware builds separately via PlatformIO (see platformio.ini).

CXX      ?= g++
# -fno-exceptions: the core must run on a microcontroller without exception
# tables, and it also keeps gcov line records free of never-executed
# exception-cleanup edges (which would break the 100% gate spuriously).
CXXFLAGS ?= -std=c++17 -fno-exceptions -Wall -Wextra -Werror -O0 -g
COVFLAGS  = --coverage
INCLUDES  = -Ilib/solarhelm/src -Ilib/simcore/src -Itests

BUILD    := build

CORE_SRCS := $(wildcard lib/solarhelm/src/sh/*/*.cpp)
SIMC_SRCS := $(wildcard lib/simcore/src/simc/*.cpp)
LIB_SRCS  := $(CORE_SRCS) $(SIMC_SRCS)
LIB_OBJS  := $(patsubst %.cpp,$(BUILD)/obj/%.o,$(LIB_SRCS))

TEST_SRCS := $(wildcard tests/test_*.cpp)
TEST_BINS := $(patsubst tests/%.cpp,$(BUILD)/tests/%,$(TEST_SRCS))

.PHONY: all sim test scenarios coverage clean

all: sim test

$(BUILD)/obj/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) $(COVFLAGS) $(INCLUDES) -c $< -o $@

sim: $(BUILD)/sim
$(BUILD)/sim: sim/main.cpp $(LIB_OBJS)
	@mkdir -p $(BUILD)
	$(CXX) $(CXXFLAGS) $(COVFLAGS) $(INCLUDES) $^ -o $@

$(BUILD)/tests/%: tests/%.cpp $(LIB_OBJS) tests/framework.h
	@mkdir -p $(BUILD)/tests
	$(CXX) $(CXXFLAGS) $(COVFLAGS) $(INCLUDES) $< $(LIB_OBJS) -o $@

test: $(TEST_BINS)
	@set -e; for t in $(TEST_BINS); do echo "== $$t"; ./$$t; done
	@echo "ALL TESTS PASSED"

scenarios: $(BUILD)/sim
	@mkdir -p sim/out
	./$(BUILD)/sim --out sim/out

coverage:
	tools/check_coverage.sh

clean:
	rm -rf $(BUILD) coverage coverage.info sim/out
