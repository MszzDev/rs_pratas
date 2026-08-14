/**
 * Valores monetários chegam da API como string (Decimal do Prisma) e podem vir
 * `null` — o servidor mascara todo valor em dinheiro para o perfil
 * DESENVOLVEDOR. Toda tela precisa lidar com isso sem quebrar.
 */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";

  const numeric = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numeric)) return "—";

  return numeric.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
