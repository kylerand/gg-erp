export interface DataColumn<TRecord> {
  key: keyof TRecord;
  label: string;
}

export interface DataTableModel<TRecord> {
  columns: DataColumn<TRecord>[];
  rows: TRecord[];
}

export function createDataTableModel<TRecord>(
  columns: DataColumn<TRecord>[],
  rows: TRecord[]
): DataTableModel<TRecord> {
  return { columns, rows };
}
