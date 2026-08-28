import { useEffect, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface StoreOption {
  id: string;
  name: string;
  code: string;
}

/**
 * A loja em que se está trabalhando.
 *
 * Quase todo funcionário pertence a uma loja só, e nesse caso perguntar qual é
 * não é escolha: é um passo obrigatório com uma resposta possível, feito toda
 * vez que a tela abre. O gancho resolve sozinho — seleciona a única loja e
 * manda esconder o seletor. Só quem tem mais de uma decide.
 */
export function useLoja(storeId: string, setStoreId: (id: string) => void) {
  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<StoreOption[]>("/api/v1/stores"),
  });

  const lojas = stores.data ?? [];
  const lojaUnica = lojas.length === 1 ? lojas[0] : undefined;

  useEffect(() => {
    if (lojaUnica && storeId !== lojaUnica.id) {
      setStoreId(lojaUnica.id);
    }
  }, [lojaUnica, storeId, setStoreId]);

  return {
    lojas,
    carregando: stores.isLoading,
    /** Com uma loja só não há o que perguntar. */
    precisaEscolher: lojas.length > 1,
  };
}

/**
 * Seletor de loja que desaparece quando não há escolha a fazer.
 *
 * Devolve `null` com uma loja só — o `useLoja` já preencheu o valor, então a
 * tela funciona sem que ninguém toque em nada.
 */
export function StorePicker({
  storeId,
  onChange,
  label = "Loja",
  className = "mb-5 max-w-xs",
  todas = false,
}: {
  storeId: string;
  onChange: (id: string) => void;
  label?: string;
  className?: string;
  /** Filtro que aceita "todas as lojas" em vez de exigir uma. */
  todas?: boolean;
}) {
  const { lojas, precisaEscolher } = useLoja(storeId, onChange);

  /**
   * Id próprio de cada seletor.
   *
   * Uma tela pode mostrar dois ao mesmo tempo — o filtro da listagem e o da
   * loja de origem, por exemplo. Com id fixo os dois teriam o MESMO, e o
   * rótulo de um passaria a apontar para o campo do outro: quem usa leitor de
   * tela ouviria "Loja" ao focar o campo errado.
   */
  const campoId = useId();

  if (!precisaEscolher) return null;

  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor={campoId}>
        {label}
      </label>
      <select
        id={campoId}
        value={storeId}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
      >
        <option value="">{todas ? "Todas" : "Selecione"}</option>
        {lojas.map((loja) => (
          <option key={loja.id} value={loja.id}>
            {loja.name}
          </option>
        ))}
      </select>
    </div>
  );
}
