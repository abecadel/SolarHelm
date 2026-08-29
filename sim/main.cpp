// SolarHelm simulator CLI.
//
// Usage:
//   sim --list                     list scenario names
//   sim [--out DIR] [name ...]     run scenarios (default: all) and write
//                                  one CSV per scenario into DIR
//                                  (default: sim/out)
//   sim --profile FILE ...         use a boat profile JSON instead of the
//                                  built-in default
//
// CSV = telemetry columns (identical to the ESP32 log format) + ground-truth
// columns prefixed "true_" that only the simulator can know.

#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "sh/telemetry/telemetry.h"
#include "simc/boat_profile.h"
#include "simc/scenario.h"
#include "simc/simulation.h"

namespace {

void printUsage() {
    std::printf(
        "SolarHelm simulator\n"
        "usage: sim [--list] [--out DIR] [--profile FILE] [scenario ...]\n");
}

bool loadProfile(const char* path, simc::BoatProfile* profile) {
    std::ifstream in(path);
    if (!in) {
        std::fprintf(stderr, "error: cannot open profile %s\n", path);
        return false;
    }
    std::stringstream ss;
    ss << in.rdbuf();
    std::string error;
    if (!simc::parseBoatProfile(ss.str(), profile, &error)) {
        std::fprintf(stderr, "error: bad profile %s: %s\n", path,
                     error.c_str());
        return false;
    }
    return true;
}

bool runScenario(const simc::BoatProfile& profile, const simc::Scenario& sc,
                 const std::string& out_dir) {
    const std::string path = out_dir + "/" + sc.name + ".csv";
    std::ofstream out(path);
    if (!out) {
        std::fprintf(stderr, "error: cannot write %s\n", path.c_str());
        return false;
    }
    out << sh::telemetryCsvHeader()
        << ",true_pv_available_w,true_pv_used_w,true_motor_w,true_hotel_w,"
           "true_battery_w,true_soc_pct,true_speed_kmh,auto_active\n";

    sh::ControlConfig config;
    config.motor_max_power_w = profile.motor_max_power_w;
    simc::Simulation sim(profile, sc, config);
    char row[512];
    while (sim.running()) {
        const simc::TickResult r = sim.step();
        sh::writeCsvRow(r.telemetry, row, sizeof(row));
        out << row;
        char truth[256];
        std::snprintf(truth, sizeof(truth),
                      ",%.1f,%.1f,%.1f,%.1f,%.1f,%.2f,%.2f,%d\n",
                      static_cast<double>(r.pv_available_w),
                      static_cast<double>(r.pv_used_w),
                      static_cast<double>(r.motor_true_w),
                      static_cast<double>(r.hotel_true_w),
                      static_cast<double>(r.battery_true_w),
                      static_cast<double>(r.soc_true_pct),
                      static_cast<double>(r.speed_true_kmh),
                      r.auto_active ? 1 : 0);
        out << truth;
    }
    std::printf("wrote %s (%s)\n", path.c_str(), sc.description);
    return true;
}

}  // namespace

int main(int argc, char** argv) {
    std::string out_dir = "sim/out";
    simc::BoatProfile profile = simc::defaultBoatProfile();
    std::vector<std::string> names;

    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--list") == 0) {
            for (const simc::Scenario& s : simc::allScenarios()) {
                std::printf("%s: %s\n", s.name, s.description);
            }
            return 0;
        }
        if (std::strcmp(argv[i], "--help") == 0) {
            printUsage();
            return 0;
        }
        if (std::strcmp(argv[i], "--out") == 0 && i + 1 < argc) {
            out_dir = argv[++i];
            continue;
        }
        if (std::strcmp(argv[i], "--profile") == 0 && i + 1 < argc) {
            if (!loadProfile(argv[++i], &profile)) {
                return 1;
            }
            continue;
        }
        names.push_back(argv[i]);
    }

    std::vector<const simc::Scenario*> to_run;
    if (names.empty()) {
        for (const simc::Scenario& s : simc::allScenarios()) {
            to_run.push_back(&s);
        }
    } else {
        for (const std::string& n : names) {
            const simc::Scenario* s = simc::findScenario(n.c_str());
            if (s == nullptr) {
                std::fprintf(stderr, "error: unknown scenario %s\n", n.c_str());
                return 1;
            }
            to_run.push_back(s);
        }
    }

    for (const simc::Scenario* s : to_run) {
        if (!runScenario(profile, *s, out_dir)) {
            return 1;
        }
    }
    return 0;
}
