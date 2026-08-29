#include "vedirect/parser.h"

#include <cstdlib>
#include <cstring>

namespace vedirect {

const char* Block::find(const char* label) const {
    for (size_t i = 0; i < count; ++i) {
        if (std::strcmp(records[i].label, label) == 0) {
            return records[i].value;
        }
    }
    return nullptr;
}

bool parseLong(const char* value, long* out) {
    if (value == nullptr || *value == '\0') {
        return false;
    }
    char* end = nullptr;
    const long v = std::strtol(value, &end, 10);
    if (end == value || *end != '\0') {
        return false;
    }
    *out = v;
    return true;
}

void Parser::abandonBlock() {
    staging_.count = 0;
    label_len_ = 0;
    value_len_ = 0;
    checksum_ = 0;
    state_ = State::kWaitStart;
    ++format_errors_;
}

bool Parser::feed(uint8_t byte) {
    // Interleaved HEX frames (':' ... '\n') may interrupt the text protocol
    // at any point except the checksum byte; their bytes are excluded from
    // the text checksum (mirrors Victron's reference handler).
    if (byte == ':' && state_ != State::kChecksum && state_ != State::kHex) {
        resume_state_ = state_;
        state_ = State::kHex;
        return false;
    }
    if (state_ == State::kHex) {
        if (byte == '\n') {
            state_ = resume_state_;
        }
        return false;
    }

    checksum_ = static_cast<uint8_t>(checksum_ + byte);

    switch (state_) {
        case State::kWaitStart:
            if (byte == '\n') {
                label_len_ = 0;
                state_ = State::kLabel;
            }
            return false;

        case State::kLabel:
            if (byte == '\t') {
                staging_.records[staging_.count].label[label_len_] = '\0';
                if (std::strcmp(staging_.records[staging_.count].label,
                                "Checksum") == 0) {
                    state_ = State::kChecksum;
                } else {
                    value_len_ = 0;
                    state_ = State::kValue;
                }
                return false;
            }
            if (byte == '\r' || byte == '\n' || label_len_ >= kMaxLabelLen) {
                abandonBlock();
                return false;
            }
            staging_.records[staging_.count].label[label_len_++] =
                static_cast<char>(byte);
            return false;

        case State::kValue:
            if (byte == '\r') {
                staging_.records[staging_.count].value[value_len_] = '\0';
                if (staging_.count + 1 >= kMaxRecords) {
                    abandonBlock();
                    return false;
                }
                ++staging_.count;
                state_ = State::kWaitStart;
                return false;
            }
            if (byte == '\n' || value_len_ >= kMaxValueLen) {
                abandonBlock();
                return false;
            }
            staging_.records[staging_.count].value[value_len_++] =
                static_cast<char>(byte);
            return false;

        case State::kChecksum: {
            const bool valid = (checksum_ == 0);
            if (valid) {
                published_ = staging_;
                ++valid_blocks_;
            } else {
                ++checksum_errors_;
            }
            staging_.count = 0;
            checksum_ = 0;
            state_ = State::kWaitStart;
            return valid;
        }

        default:  // LCOV_EXCL_LINE unreachable: kHex handled above
            return false;  // LCOV_EXCL_LINE
    }
}

size_t Parser::feed(const uint8_t* data, size_t len) {
    size_t blocks = 0;
    for (size_t i = 0; i < len; ++i) {
        if (feed(data[i])) {
            ++blocks;
        }
    }
    return blocks;
}

}  // namespace vedirect
