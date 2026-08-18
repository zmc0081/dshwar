// 手写(非生成)—— SDK 的支撑类型。
//
// ⚠️ 与 src/generated/ 分开是刻意的:生成目录**整个可以删掉重来**,
// 而这里的东西不行。混在一起的话,下一次 generate 会把手写的部分抹掉。

import Foundation

/// 结构不透明的 JSON 值。
///
/// Swift 标准库没有对应物,而 `Any` 不是 `Codable` —— 契约里的
/// `metadata` / 审计的 `before`/`after` 这类字段(`z.unknown()`)需要它。
///
/// 刻意保持最小:它只负责**原样往返**,不提供便利访问器。
/// 调用方知道自己那份 metadata 长什么样,由调用方去解。
public struct AnyCodable: Codable, Sendable {
    public let value: Sendable?

    public init(_ value: Sendable?) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self.value = nil
        } else if let bool = try? container.decode(Bool.self) {
            self.value = bool
        } else if let int = try? container.decode(Int64.self) {
            self.value = int
        } else if let double = try? container.decode(Double.self) {
            self.value = double
        } else if let string = try? container.decode(String.self) {
            self.value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            self.value = array
        } else if let object = try? container.decode([String: AnyCodable].self) {
            self.value = object
        } else {
            // 认不出就抛,不回落成 nil —— 静默丢掉一段审计数据比报错糟得多
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "AnyCodable 认不出这个 JSON 值"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case nil: try container.encodeNil()
        case let v as Bool: try container.encode(v)
        case let v as Int64: try container.encode(v)
        case let v as Double: try container.encode(v)
        case let v as String: try container.encode(v)
        case let v as [AnyCodable]: try container.encode(v)
        case let v as [String: AnyCodable]: try container.encode(v)
        default:
            throw EncodingError.invalidValue(
                value as Any,
                EncodingError.Context(codingPath: container.codingPath,
                                      debugDescription: "AnyCodable 编不了这个值")
            )
        }
    }
}
