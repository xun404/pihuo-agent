export function setRecordKey<K extends string, V>(
  record: Record<K, V>,
  key: K,
  value: V,
): Record<K, V> {
  if (record[key] === value) return record
  return { ...record, [key]: value }
}
