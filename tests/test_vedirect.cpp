// Unit tests: VE.Direct text-protocol parser + SmartShunt/MPPT adapters.
//
// Frames are synthesised with correct modulo-256 checksums, exactly as a
// SmartShunt emits them (VE.Direct Protocol v3.34); corruption, HEX
// interleaving, mid-stream joins and malformed input are all exercised.

#include <string>
#include <utility>
#include <vector>

#include "framework.h"
#include "vedirect/monitors.h"
#include "vedirect/parser.h"

using vedirect::Parser;
using vedirect::parseLong;
using vedirect::SmartShuntMonitor;
using vedirect::VictronMpptMonitor;

namespace {

using Fields = std::vector<std::pair<std::string, std::string>>;

// Builds one checksummed VE.Direct block from label/value pairs.
std::string makeBlock(const Fields& fields) {
    std::string s;
    for (const auto& f : fields) {
        s += "\r\n" + f.first + "\t" + f.second;
    }
    s += "\r\nChecksum\t";
    unsigned sum = 0;
    for (unsigned char c : s) {
        sum += c;
    }
    s += static_cast<char>((256 - (sum % 256)) % 256);
    return s;
}

Fields shuntFields() {
    return {{"PID", "0xA389"}, {"V", "25600"},   {"I", "-1500"},
            {"P", "-38"},      {"SOC", "834"},   {"CE", "-4200"},
            {"TTG", "1440"},   {"Alarm", "OFF"}, {"H4", "0"}};
}

size_t feedAll(Parser& p, const std::string& s) {
    return p.feed(reinterpret_cast<const uint8_t*>(s.data()), s.size());
}

}  // namespace

TEST(parse_long_accepts_numbers_rejects_garbage) {
    long v = 0;
    CHECK(parseLong("25600", &v));
    CHECK(v == 25600);
    CHECK(parseLong("-1500", &v));
    CHECK(v == -1500);
    CHECK(!parseLong("", &v));
    CHECK(!parseLong(nullptr, &v));
    CHECK(!parseLong("---", &v));
    CHECK(!parseLong("12x", &v));
    CHECK(!parseLong("OFF", &v));
}

TEST(parser_accepts_a_valid_block) {
    Parser p;
    CHECK(feedAll(p, makeBlock(shuntFields())) == 1);
    CHECK(p.validBlocks() == 1);
    CHECK(p.checksumErrors() == 0);
    CHECK(p.formatErrors() == 0);
    const vedirect::Block& b = p.block();
    CHECK(b.count == 9);
    CHECK(std::string(b.find("V")) == "25600");
    CHECK(std::string(b.find("I")) == "-1500");
    CHECK(std::string(b.find("Alarm")) == "OFF");
    CHECK(b.find("Nonexistent") == nullptr);
}

TEST(parser_handles_consecutive_blocks) {
    Parser p;
    std::string stream;
    for (int i = 0; i < 5; ++i) {
        stream += makeBlock(shuntFields());
    }
    CHECK(feedAll(p, stream) == 5);
    CHECK(p.validBlocks() == 5);
    CHECK(p.checksumErrors() == 0);
}

TEST(parser_rejects_corrupted_checksum_and_keeps_last_good_block) {
    Parser p;
    feedAll(p, makeBlock(shuntFields()));
    std::string bad = makeBlock({{"V", "11111"}, {"I", "0"}});
    bad[bad.size() - 1] ^= 0x5A;  // corrupt the checksum byte
    CHECK(feedAll(p, bad) == 0);
    CHECK(p.checksumErrors() == 1);
    CHECK(std::string(p.block().find("V")) == "25600");  // previous kept
    // Recovery: the next clean block parses.
    CHECK(feedAll(p, makeBlock({{"V", "22222"}, {"I", "5"}})) == 1);
    CHECK(std::string(p.block().find("V")) == "22222");
}

TEST(parser_survives_mid_stream_join) {
    Parser p;
    const std::string full = makeBlock(shuntFields());
    // Join half-way through a block: that block (and possibly the next,
    // depending on the running checksum) is lost; the stream resyncs.
    feedAll(p, full.substr(full.size() / 2));
    feedAll(p, full);
    feedAll(p, full);
    CHECK(p.validBlocks() >= 1);
    CHECK(std::string(p.block().find("V")) == "25600");
}

TEST(parser_skips_interleaved_hex_frames) {
    Parser p;
    const std::string block = makeBlock(shuntFields());
    const std::string hex = ":A0102000543\n";
    // HEX frame before, inside (mid-record), and between blocks.
    std::string stream = hex + block;
    const size_t mid = block.size() / 3;
    stream += block.substr(0, mid) + hex + block.substr(mid);
    stream += hex;
    stream += block;
    CHECK(feedAll(p, stream) == 3);
    CHECK(p.checksumErrors() == 0);
    CHECK(p.formatErrors() == 0);
}

TEST(parser_abandons_oversized_label_and_recovers) {
    Parser p;
    CHECK(feedAll(p, "\r\nWayTooLongLabel\tvalue") == 0);
    CHECK(p.formatErrors() == 1);
    // The abandoned tail desyncs at most the next block's checksum; feed
    // two clean ones and require the last to land.
    feedAll(p, makeBlock(shuntFields()));
    CHECK(feedAll(p, makeBlock({{"V", "24000"}, {"I", "7"}})) == 1);
    CHECK(std::string(p.block().find("V")) == "24000");
}

TEST(parser_abandons_oversized_value) {
    Parser p;
    const std::string long_value(40, 'x');
    CHECK(feedAll(p, "\r\nH9\t" + long_value) == 0);
    CHECK(p.formatErrors() == 1);
}

TEST(parser_abandons_malformed_records) {
    Parser p;
    feedAll(p, "\r\nV\rOops");  // CR inside a label
    CHECK(p.formatErrors() == 1);
    Parser q;
    feedAll(q, "\r\nV\t123\nno_cr");  // LF inside a value
    CHECK(q.formatErrors() == 1);
}

TEST(parser_abandons_block_with_too_many_records) {
    Parser p;
    Fields many;
    for (int i = 0; i < 25; ++i) {
        many.push_back({"H" + std::to_string(i), "1"});
    }
    CHECK(feedAll(p, makeBlock(many)) == 0);
    CHECK(p.formatErrors() >= 1);
}

TEST(shunt_monitor_converts_fields_and_sign_convention) {
    SmartShuntMonitor m;
    CHECK(!m.read().valid);  // nothing yet
    const std::string block = makeBlock(shuntFields());
    CHECK(m.feed(reinterpret_cast<const uint8_t*>(block.data()), block.size(),
                 5000) == 1);
    const sh::BatterySample s = m.read();
    CHECK(s.valid);
    CHECK(s.timestamp_ms == 5000);
    CHECK_NEAR(s.voltage_v, 25.6f, 1e-4);
    CHECK_NEAR(s.current_a, -1.5f, 1e-4);  // discharging = negative
    CHECK_NEAR(s.power_w, -38.0f, 1e-4);
    CHECK_NEAR(s.soc_pct, 83.4f, 1e-4);
}

TEST(shunt_monitor_parses_aux_temperature) {
    SmartShuntMonitor m;
    Fields f = shuntFields();
    f.push_back({"T", "23"});
    const std::string block = makeBlock(f);
    m.feed(reinterpret_cast<const uint8_t*>(block.data()), block.size(), 1000);
    sh::BatterySample s = m.read();
    CHECK(s.has_temperature);
    CHECK_NEAR(s.temperature_c, 23.0f, 1e-6);
    // Without T the flag stays off.
    const std::string plain = makeBlock(shuntFields());
    m.feed(reinterpret_cast<const uint8_t*>(plain.data()), plain.size(), 2000);
    CHECK(!m.read().has_temperature);
}

TEST(shunt_monitor_computes_power_when_p_missing_and_keeps_soc) {
    SmartShuntMonitor m;
    const std::string first = makeBlock(shuntFields());
    m.feed(reinterpret_cast<const uint8_t*>(first.data()), first.size(), 1000);
    // Next block: no P, no SOC.
    const std::string second =
        makeBlock({{"V", "26000"}, {"I", "2000"}});
    CHECK(m.feed(reinterpret_cast<const uint8_t*>(second.data()),
                 second.size(), 2000) == 1);
    const sh::BatterySample s = m.read();
    CHECK(s.timestamp_ms == 2000);
    CHECK_NEAR(s.power_w, 26.0f * 2.0f, 1e-3);  // V*I fallback
    CHECK_NEAR(s.soc_pct, 83.4f, 1e-4);         // retained from before
}

TEST(shunt_monitor_ignores_blocks_without_mandatory_fields) {
    SmartShuntMonitor m;
    const std::string mppt_block =
        makeBlock({{"VPV", "48000"}, {"PPV", "512"}, {"CS", "3"}});
    CHECK(m.feed(reinterpret_cast<const uint8_t*>(mppt_block.data()),
                 mppt_block.size(), 1000) == 1);  // parses, but...
    CHECK(!m.read().valid);                       // ...no battery sample
    // Also a block with V but non-numeric I.
    const std::string weird = makeBlock({{"V", "25000"}, {"I", "---"}});
    m.feed(reinterpret_cast<const uint8_t*>(weird.data()), weird.size(), 1100);
    CHECK(!m.read().valid);
}

TEST(shunt_monitor_handles_chunked_uart_delivery) {
    SmartShuntMonitor m;
    const std::string block = makeBlock(shuntFields());
    size_t total = 0;
    // Deliver in 3-byte chunks like a UART FIFO would.
    for (size_t i = 0; i < block.size(); i += 3) {
        const size_t n = (i + 3 <= block.size()) ? 3 : block.size() - i;
        total += m.feed(reinterpret_cast<const uint8_t*>(block.data() + i), n,
                        7000);
    }
    CHECK(total == 1);
    CHECK(m.read().valid);
    CHECK(m.parser().validBlocks() == 1);
}

TEST(mppt_monitor_reads_ppv_and_charge_state) {
    VictronMpptMonitor m;
    CHECK(!m.read().valid);
    CHECK(m.chargeState() == -1);
    const std::string block = makeBlock(
        {{"PID", "0xA060"}, {"VPV", "68000"}, {"PPV", "512"}, {"CS", "5"}});
    CHECK(m.feed(reinterpret_cast<const uint8_t*>(block.data()), block.size(),
                 3000) == 1);
    const sh::SolarSample s = m.read();
    CHECK(s.valid);
    CHECK(s.timestamp_ms == 3000);
    CHECK_NEAR(s.power_w, 512.0f, 1e-4);
    CHECK(m.chargeState() == 5);  // float: charger curtailing
    // CS optional: next block without it keeps the last state.
    const std::string no_cs = makeBlock({{"PPV", "600"}});
    m.feed(reinterpret_cast<const uint8_t*>(no_cs.data()), no_cs.size(), 4000);
    CHECK_NEAR(m.read().power_w, 600.0f, 1e-4);
    CHECK(m.chargeState() == 5);
    // Non-MPPT block ignored.
    const std::string shunt_block = makeBlock({{"V", "25600"}, {"I", "0"}});
    m.feed(reinterpret_cast<const uint8_t*>(shunt_block.data()),
           shunt_block.size(), 5000);
    CHECK(m.read().timestamp_ms == 4000);
}

TEST_MAIN()
