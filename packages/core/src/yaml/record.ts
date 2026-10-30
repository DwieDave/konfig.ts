import { Schema } from "effect"

const _record = Schema.Record(Schema.String, Schema.Unknown)

export type YamlRecord = typeof _record.Type
