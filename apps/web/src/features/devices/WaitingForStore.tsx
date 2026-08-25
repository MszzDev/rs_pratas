import { LogoMark } from "@/components/ui/logo";
import { StatusStrip } from "@/components/ui/status-strip";

/**
 * A tela do tablet recém-ligado.
 *
 * Não pede nada. Não tem campo, não tem código para digitar, não tem botão —
 * porque não há nada que a pessoa segurando o tablet possa fazer aqui. Quem
 * resolve é o dono, de outro aparelho.
 *
 * O que a tela faz é dizer COMO o aparelho aparece na lista dele, para o dono
 * saber qual dos três tablets é este.
 */
export function WaitingForStore({ apelido }: { apelido: string }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-brand px-6 text-center">
      {/* Hora, bateria e brilho também aqui: o tablet pode passar horas nesta
          tela antes de alguém vinculá-lo, e ela é tudo o que ele mostra. */}
      <div className="absolute right-4 top-4">
        <StatusStrip />
      </div>

      <LogoMark className="h-32 w-32" />

      <h1 className="mt-8 text-2xl font-medium text-text-primary">
        Este tablet ainda não tem loja
      </h1>

      <p className="mt-3 max-w-md text-text-secondary">
        Peça a quem administra o sistema para vincular este aparelho a uma loja. Ele faz isso pelo
        celular ou pelo computador, em <strong>Lojas → Tablets</strong>.
      </p>

      {apelido && (
        <div className="mt-8 rounded-lg border border-border bg-surface px-6 py-4">
          <p className="text-sm text-text-muted">Este aparelho aparece na lista como</p>
          <p className="mt-1 font-medium text-text-primary">{apelido}</p>
        </div>
      )}

      <p className="mt-8 flex items-center gap-2 text-sm text-text-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-sage" aria-hidden />
        Verificando a cada instante — assim que for vinculado, esta tela sai sozinha
      </p>
    </main>
  );
}
