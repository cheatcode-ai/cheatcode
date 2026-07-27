interface PgQueryResult {
  rows: Record<string, unknown>[];
}

export interface PgClient {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
}
