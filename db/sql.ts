/**
 * Gera o SQL de criação a partir do schema Drizzle.
 *
 * O esquema vinha declarado duas vezes: como tabelas Drizzle em `db/schema.ts`,
 * usadas para gerar migrações, e como constantes `CREATE TABLE IF NOT EXISTS`
 * escritas à mão no Worker, que são o que de fato roda em produção. Nada
 * garantia que as duas ficassem iguais — uma coluna acrescentada num lado e
 * esquecida no outro só apareceria como erro de SQL em tempo de execução.
 *
 * Agora `db/schema.ts` é a única fonte: o Drizzle continua gerando as migrações
 * a partir dele, e o Worker cria as tabelas a partir do mesmo lugar.
 */

import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";

/** Traduz o tipo da coluna Drizzle para o tipo de armazenamento do SQLite. */
function tipoSqlite(coluna: { getSQLType(): string }): string {
  const tipo = coluna.getSQLType().toLowerCase();
  if (tipo.startsWith("int")) return "INTEGER";
  if (tipo.startsWith("real") || tipo.startsWith("num")) return "REAL";
  if (tipo.startsWith("blob")) return "BLOB";
  return "TEXT";
}

/**
 * `CREATE TABLE IF NOT EXISTS` de uma tabela do schema.
 *
 * `IF NOT EXISTS` é deliberado: em um banco que já existe esta instrução não
 * faz nada, e as colunas acrescentadas depois entram por `ensureColumns`, que
 * só adiciona. Nenhum dado gravado é reescrito.
 */
export function createTableSql(table: SQLiteTable): string {
  const config = getTableConfig(table);
  const colunas = config.columns.map(coluna => {
    const partes = [`${coluna.name} ${tipoSqlite(coluna)}`];
    if (coluna.primary) partes.push("PRIMARY KEY");
    if (coluna.notNull && !coluna.primary) partes.push("NOT NULL");
    const padrao = coluna.default;
    if (padrao !== undefined && (typeof padrao === "number" || typeof padrao === "string")) {
      partes.push(`DEFAULT ${typeof padrao === "string" ? `'${padrao}'` : padrao}`);
    }
    return partes.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS ${config.name} (${colunas.join(", ")})`;
}

/** `CREATE INDEX`/`CREATE UNIQUE INDEX` declarados na mesma tabela. */
export function createIndexesSql(table: SQLiteTable): string[] {
  const config = getTableConfig(table);
  return config.indexes.map(indice => {
    const cfg = indice.config;
    const colunas = (cfg.columns as Array<{ name?: string }>).map(c => c.name).filter(Boolean).join(", ");
    return `CREATE ${cfg.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${cfg.name} ON ${config.name} (${colunas})`;
  });
}

/** Todo o SQL necessário para uma tabela existir: a tabela e os seus índices. */
export function tableSql(table: SQLiteTable): string[] {
  return [createTableSql(table), ...createIndexesSql(table)];
}

/** As colunas de uma tabela, para `ensureColumns` saber o que pode faltar. */
export function tableColumns(table: SQLiteTable): Record<string, string> {
  return Object.fromEntries(getTableConfig(table).columns.map(coluna => [coluna.name, tipoSqlite(coluna)]));
}
