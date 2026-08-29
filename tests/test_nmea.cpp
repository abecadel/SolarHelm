// Unit tests: NMEA 0183 parser + GpsMonitor adapter.

#include <cctype>
#include <string>

#include "framework.h"
#include "nmea/parser.h"

using nmea::GpsMonitor;
using nmea::Parser;
using nmea::parseDouble;
using nmea::parseLatLon;

namespace {

// Builds "$<body>*hh\r\n" with the correct XOR checksum.
std::string makeSentence(const std::string& body) {
    uint8_t sum = 0;
    for (unsigned char c : body) {
        sum ^= c;
    }
    char cs[4];
    std::snprintf(cs, sizeof(cs), "%02X", sum);
    return "$" + body + "*" + cs + "\r\n";
}

size_t feedAll(Parser& p, const std::string& s) {
    size_t n = 0;
    for (unsigned char c : s) {
        if (p.feed(c)) {
            ++n;
        }
    }
    return n;
}

size_t feedMon(GpsMonitor& m, const std::string& s, uint32_t t) {
    return m.feed(reinterpret_cast<const uint8_t*>(s.data()), s.size(), t);
}

const char* kRmcBody =
    "GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W";

}  // namespace

TEST(parse_double_and_latlon) {
    double v = 0.0;
    CHECK(parseDouble("22.4", &v));
    CHECK_NEAR(v, 22.4, 1e-9);
    CHECK(!parseDouble("", &v));
    CHECK(!parseDouble(nullptr, &v));
    CHECK(!parseDouble("x", &v));
    CHECK(!parseDouble("1.2y", &v));

    double deg = 0.0;
    CHECK(parseLatLon("4807.038", "N", &deg));
    CHECK_NEAR(deg, 48.1173, 1e-4);
    CHECK(parseLatLon("4807.038", "S", &deg));
    CHECK_NEAR(deg, -48.1173, 1e-4);
    CHECK(parseLatLon("01131.000", "E", &deg));
    CHECK_NEAR(deg, 11.5166667, 1e-4);
    CHECK(parseLatLon("01131.000", "W", &deg));
    CHECK_NEAR(deg, -11.5166667, 1e-4);
    CHECK(!parseLatLon("", "N", &deg));
    CHECK(!parseLatLon("4807.038", "", &deg));
    CHECK(!parseLatLon("4807.038", "Q", &deg));
    CHECK(!parseLatLon("4807.038", nullptr, &deg));
}

TEST(parser_accepts_valid_sentence_and_splits_fields) {
    Parser p;
    CHECK(feedAll(p, makeSentence(kRmcBody)) == 1);
    CHECK(p.validSentences() == 1);
    const nmea::Sentence& s = p.sentence();
    CHECK(s.count == 12);
    CHECK(std::string(s.field(0)) == "GPRMC");
    CHECK(std::string(s.field(2)) == "A");
    CHECK(std::string(s.field(7)) == "022.4");
    CHECK(std::string(s.field(99)) == "");  // out of range -> ""
    CHECK(s.isType("RMC"));
    CHECK(!s.isType("VTG"));
    CHECK(!s.isType("TOOLONGTYPE"));
    const nmea::Sentence empty{};
    CHECK(!empty.isType("RMC"));  // defensive guard on an unparsed sentence
}

TEST(parser_accepts_lowercase_checksum_hex) {
    Parser p;
    std::string s = makeSentence(kRmcBody);
    for (size_t i = s.size() - 4; i < s.size() - 2; ++i) {
        s[i] = static_cast<char>(std::tolower(s[i]));
    }
    CHECK(feedAll(p, s) == 1);
}

TEST(parser_accepts_any_talker) {
    Parser p;
    feedAll(p, makeSentence("GNRMC,123519,A,4807.038,N,01131.000,E,1.0,0.0,"
                            "230394,,"));
    CHECK(p.sentence().isType("RMC"));
}

TEST(parser_rejects_bad_checksum_and_malformed_tails) {
    Parser p;
    std::string bad = makeSentence(kRmcBody);
    bad[bad.size() - 3] = '0';  // clobber checksum hex
    CHECK(feedAll(p, bad) == 0);
    CHECK(p.checksumErrors() == 1);
    CHECK(feedAll(p, "$GPRMC,noline\r\n") == 0);        // no '*'
    CHECK(feedAll(p, "$GPRMC,x*4\r\n") == 0);           // 1 hex digit
    CHECK(feedAll(p, "$GPRMC,x*ZZ\r\n") == 0);          // non-hex
    CHECK(p.checksumErrors() == 4);
}

TEST(parser_ignores_noise_and_recovers) {
    Parser p;
    // Garbage before '$', an interrupted sentence, then a clean one.
    const std::string stream = "garbage bytes" +
                               std::string("$GPRMC,interrupted") +
                               makeSentence(kRmcBody);
    CHECK(feedAll(p, stream) == 1);  // the '$' of the clean one resyncs
    CHECK(p.validSentences() == 1);
}

TEST(parser_overflow_guard) {
    Parser p;
    std::string longline = "$" + std::string(200, 'A') + "\r\n";
    CHECK(feedAll(p, longline) == 0);
    CHECK(p.overflows() == 1);
    CHECK(feedAll(p, makeSentence(kRmcBody)) == 1);  // recovers
}

TEST(gps_monitor_parses_rmc_fix) {
    GpsMonitor m;
    CHECK(!m.read().valid);
    CHECK(feedMon(m, makeSentence(kRmcBody), 1000) == 1);
    const sh::GpsSample g = m.read();
    CHECK(g.valid);
    CHECK(g.timestamp_ms == 1000);
    CHECK_NEAR(g.speed_mps, 22.4 * 0.514444, 1e-3);
    CHECK_NEAR(g.course_deg, 84.4, 1e-3);
    CHECK_NEAR(g.latitude_deg, 48.1173, 1e-4);
    CHECK_NEAR(g.longitude_deg, 11.5167, 1e-4);
    CHECK(g.fix_quality == 1);
}

TEST(gps_monitor_void_rmc_does_not_refresh) {
    GpsMonitor m;
    feedMon(m, makeSentence(kRmcBody), 1000);
    // Void fix (status V): sample must not refresh (stays at t=1000).
    feedMon(m,
            makeSentence("GPRMC,123520,V,,,,,,,230394,,"), 2000);
    CHECK(m.read().timestamp_ms == 1000);
    // RMC with unparseable position: also ignored.
    feedMon(m, makeSentence("GPRMC,123521,A,,,,,1.0,0.0,230394,,"), 3000);
    CHECK(m.read().timestamp_ms == 1000);
}

TEST(gps_monitor_vtg_refreshes_speed_only_after_fix) {
    GpsMonitor m;
    // VTG before any fix: ignored (no validity flag of its own).
    feedMon(m, makeSentence("GPVTG,084.4,T,,M,010.0,N,018.5,K,A"), 500);
    CHECK(!m.read().valid);
    feedMon(m, makeSentence(kRmcBody), 1000);
    feedMon(m, makeSentence("GPVTG,090.0,T,,M,010.0,N,018.5,K,A"), 1200);
    const sh::GpsSample g = m.read();
    CHECK(g.timestamp_ms == 1200);
    CHECK_NEAR(g.speed_mps, 10.0 * 0.514444, 1e-3);
    CHECK_NEAR(g.course_deg, 90.0, 1e-3);
    // Empty-speed VTG (no fix on receiver side): ignored.
    feedMon(m, makeSentence("GPVTG,,T,,M,,N,,K,N"), 1400);
    CHECK(m.read().timestamp_ms == 1200);
}

TEST(gps_monitor_gga_updates_quality_and_satellites) {
    GpsMonitor m;
    feedMon(m, makeSentence(kRmcBody), 1000);
    feedMon(m,
            makeSentence("GPGGA,123519,4807.038,N,01131.000,E,2,11,0.9,"
                         "545.4,M,46.9,M,,"),
            1100);
    sh::GpsSample g = m.read();
    CHECK(g.fix_quality == 2);
    CHECK(g.satellites == 11);
    CHECK(g.valid);
    // GGA reporting fix lost invalidates the sample.
    feedMon(m,
            makeSentence("GPGGA,123520,,,,,0,03,,,M,,M,,"), 1200);
    g = m.read();
    CHECK(g.fix_quality == 0);
    CHECK(!g.valid);
    // GGA with empty quality field changes nothing.
    feedMon(m, makeSentence("GPGGA,123521,,,,,,,,,M,,M,,"), 1300);
    CHECK(m.read().fix_quality == 0);
}

TEST(gps_monitor_chunked_delivery) {
    GpsMonitor m;
    const std::string s = makeSentence(kRmcBody);
    size_t total = 0;
    for (size_t i = 0; i < s.size(); i += 2) {
        const size_t n = (i + 2 <= s.size()) ? 2 : s.size() - i;
        total += m.feed(reinterpret_cast<const uint8_t*>(s.data() + i), n,
                        9000);
    }
    CHECK(total == 1);
    CHECK(m.read().valid);
    CHECK(m.parser().validSentences() == 1);
}

TEST_MAIN()
