import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { CARD_METHODS, PAYMENT_LABELS, PAYMENT_METHODS } from "./types";
import type { CartLine, PaymentMethod } from "./types";

interface PaymentLine {
  method: PaymentMethod;
  amount: string;
  installments: number;
  terminalId: string;
  authorizationCode: string;
  tenderedAmount: string;
}

interface Terminal {
  id: string;
  provider: string | null;
  serialNumber: string | null;
  status: string;
  isPrimary: boolean;
  deviceId: string;
}

const emptyLine = (amount: number): PaymentLine => ({
  method: "DINHEIRO",
  amount: amount.toFixed(2),
  installments: 1,
  terminalId: "",
  authorizationCode: "",
  tenderedAmount: "",
});

/**
 * Pagamento — inclusive dividido em até quatro formas.
 *
 * A soma tem que fechar exatamente com o total. A tela avisa antes de enviar,
 * mas quem recusa de verdade é o servidor: a conferência aqui é conveniência
 * para o vendedor, não controle.
 */
export function PaymentDialog({
  storeId,
  sessionId,
  cart,
  customerId,
  total,
  onClose,
  onCompleted,
}: {
  storeId: string;
  sessionId: string;
  cart: CartLine[];
  customerId: string | null;
  total: number;
  onClose: () => void;
  onCompleted: (sale: { id: string; code: string; totalAmount: string }) => void;
}) {
  const [discount, setDiscount] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [lines, setLines] = useState<PaymentLine[]>([emptyLine(total)]);
  const [error, setError] = useState<string | null>(null);

  const finalTotal = Math.max(0, total - Number(discount || 0));

  const paid = useMemo(
    () => lines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
    [lines],
  );
  const remaining = Number((finalTotal - paid).toFixed(2));

  const needsTerminal = lines.some((line) => CARD_METHODS.includes(line.method));

  const terminals = useQuery({
    queryKey: ["terminals", storeId],
    queryFn: () => apiFetch<Terminal[]>(`/api/v1/terminals?storeId=${storeId}`),
    enabled: needsTerminal,
  });

  const usableTerminals = (terminals.data ?? []).filter(
    (terminal) => terminal.status === "ACTIVE",
  );

  /** A maquininha escolhida em alguma das formas de pagamento em cartão. */
  const chosenTerminal = usableTerminals.find((terminal) =>
    lines.some((line) => line.terminalId === terminal.id),
  );

  const complete = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; code: string; totalAmount: string }>("/api/v1/sales", {
        method: "POST",
        body: {
          storeId,
          sessionId,
          ...(customerId ? { customerId } : {}),
          // O tablet manda o que vai levar; o quanto custa o servidor decide.
          items: cart.map((line) => ({
            productId: line.productId,
            ...(line.variationId ? { variationId: line.variationId } : {}),
            quantity: line.quantity,
          })),
          ...(Number(discount) > 0 ? { discountAmount: Number(discount) } : {}),
          ...(discountReason ? { discountReason } : {}),
          payments: lines.map((line) => ({
            method: line.method,
            amount: Number(line.amount),
            ...(line.method === "CREDITO_PARCELADO"
              ? { installments: line.installments }
              : {}),
            ...(line.terminalId ? { terminalId: line.terminalId } : {}),
            ...(line.authorizationCode ? { authorizationCode: line.authorizationCode } : {}),
            ...(line.method === "DINHEIRO" && line.tenderedAmount
              ? { tenderedAmount: Number(line.tenderedAmount) }
              : {}),
          })),
          // O tablet vinculado à maquininha escolhida. O servidor confere se
          // maquininha, caixa e tablet são o mesmo conjunto — mandar daqui é
          // conveniência, a validação é lá.
          ...(chosenTerminal ? { deviceId: chosenTerminal.deviceId } : {}),
        },
      }),
    onSuccess: onCompleted,
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : "Não foi possível concluir a venda.",
      ),
  });

  function updateLine(index: number, patch: Partial<PaymentLine>) {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  }

  const cashLine = lines.find((line) => line.method === "DINHEIRO" && line.tenderedAmount);
  const change = cashLine
    ? Number(cashLine.tenderedAmount || 0) - Number(cashLine.amount || 0)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-text-primary/40 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-lg bg-surface p-6 sm:rounded-lg">
        <h2 className="mb-1 text-xl font-semibold text-text-primary">Pagamento</h2>
        <p className="mb-5 text-text-secondary">
          {cart.length} item(ns) · {formatMoney(String(total))}
        </p>

        {error && (
          <div className="mb-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <Field
            label="Desconto (R$)"
            type="number"
            step="0.01"
            min={0}
            max={total}
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
          />
          {Number(discount) > 0 && (
            <Field
              label="Motivo do desconto"
              value={discountReason}
              onChange={(event) => setDiscountReason(event.target.value)}
              hint="Acima de 5% precisa de autorização do responsável."
            />
          )}
        </div>

        <div className="mb-4 flex items-baseline justify-between border-y border-border py-3">
          <span className="text-text-secondary">Total a pagar</span>
          <span className="text-2xl font-semibold text-text-primary">
            {formatMoney(String(finalTotal))}
          </span>
        </div>

        <ul className="space-y-4">
          {lines.map((line, index) => (
            <li key={index} className="rounded-md border border-border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <select
                  aria-label="Forma de pagamento"
                  value={line.method}
                  onChange={(event) =>
                    updateLine(index, { method: event.target.value as PaymentMethod })
                  }
                  className="min-h-[48px] flex-1 rounded-md border border-border bg-surface px-3 text-text-primary"
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {PAYMENT_LABELS[method]}
                    </option>
                  ))}
                </select>

                {lines.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remover forma de pagamento"
                    onClick={() =>
                      setLines((current) => current.filter((_, position) => position !== index))
                    }
                    className="rounded p-2 text-text-muted hover:bg-background-secondary"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Valor (R$)"
                  type="number"
                  step="0.01"
                  min={0}
                  value={line.amount}
                  onChange={(event) => updateLine(index, { amount: event.target.value })}
                />

                {line.method === "DINHEIRO" && (
                  <Field
                    label="Recebido do cliente"
                    type="number"
                    step="0.01"
                    min={0}
                    value={line.tenderedAmount}
                    onChange={(event) => updateLine(index, { tenderedAmount: event.target.value })}
                    hint="Para calcular o troco."
                  />
                )}

                {line.method === "CREDITO_PARCELADO" && (
                  <Field
                    label="Parcelas"
                    type="number"
                    min={2}
                    max={24}
                    value={String(line.installments)}
                    onChange={(event) =>
                      updateLine(index, { installments: Number(event.target.value) })
                    }
                  />
                )}

                {CARD_METHODS.includes(line.method) && (
                  <>
                    <div>
                      <label
                        className="mb-1 block text-sm font-medium text-text-secondary"
                        htmlFor={`maquininha-${index}`}
                      >
                        Maquininha
                      </label>
                      <select
                        id={`maquininha-${index}`}
                        value={line.terminalId}
                        onChange={(event) => updateLine(index, { terminalId: event.target.value })}
                        className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
                      >
                        <option value="">Selecione</option>
                        {usableTerminals.map((terminal) => (
                          <option key={terminal.id} value={terminal.id}>
                            {terminal.provider ?? "Maquininha"}
                            {terminal.serialNumber ? ` · ${terminal.serialNumber}` : ""}
                            {terminal.isPrimary ? " (principal)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <Field
                      label="Código de autorização"
                      value={line.authorizationCode}
                      onChange={(event) =>
                        updateLine(index, { authorizationCode: event.target.value })
                      }
                      hint="O que aparece no comprovante da maquininha."
                    />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>

        {lines.length < 4 && remaining > 0 && (
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => setLines((current) => [...current, emptyLine(remaining)])}
          >
            <Plus className="h-5 w-5" aria-hidden />
            Dividir com outra forma
          </Button>
        )}

        <div className="mt-5 space-y-1 border-t border-border pt-4 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Somado nas formas</span>
            <span className="text-text-primary">{formatMoney(String(paid))}</span>
          </div>
          {remaining !== 0 && (
            <div className="flex justify-between font-medium text-danger">
              <span>{remaining > 0 ? "Ainda falta" : "Passou do total em"}</span>
              <span>{formatMoney(String(Math.abs(remaining)))}</span>
            </div>
          )}
          {change > 0 && (
            <div className="flex justify-between font-medium text-success">
              <span>Troco</span>
              <span>{formatMoney(String(change))}</span>
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <Button
            type="button"
            size="lg"
            className="flex-1"
            disabled={remaining !== 0 || complete.isPending}
            onClick={() => {
              setError(null);
              complete.mutate();
            }}
          >
            Concluir venda
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={onClose}>
            Voltar
          </Button>
        </div>
      </div>
    </div>
  );
}
